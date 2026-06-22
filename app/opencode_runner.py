import os
import re
import json
import time
import asyncio
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

OPENCODE_BIN = os.path.expanduser("~/.opencode/bin/opencode")


@dataclass
class OpenCodeResult:
    """Result from a single OpenCode run."""
    events: list[dict] = field(default_factory=list)
    tool_calls: list[dict] = field(default_factory=list)
    files_modified: list[str] = field(default_factory=list)
    text_output: str = ""
    raw_output: str = ""
    exit_code: int = 0
    latency_ms: int = 0
    success: bool = True
    error: str = ""


class OpenCodeRunner:

    def __init__(
        self,
        workspace_dir: str,
        model: str = "ollama/qwen3:8b",
    ):
        self.workspace = Path(workspace_dir).resolve()
        self.model = model
        self.workspace.mkdir(parents=True, exist_ok=True)

        if not os.path.isfile(OPENCODE_BIN):
            print(f"  [opencode] WARNING: Binary not found at {OPENCODE_BIN}")
            print(f"  [opencode] Install: curl -fsSL https://opencode.ai/install | bash")

    async def run(self, prompt: str, continue_session: bool = False, timeout: int = 600) -> OpenCodeResult:

        start_time = time.time()

        cmd = [
            OPENCODE_BIN, "run",
            "--model", self.model,
            "--format", "json",
            "--dangerously-skip-permissions",
            "--dir", str(self.workspace),
        ]

        if continue_session:
            cmd.append("--continue")

        cmd.append(prompt)

        env = {
            **os.environ,
            "PWD": str(self.workspace),
            "HOME": os.path.expanduser("~"),
            "NO_COLOR": "1",
            "TERM": "dumb",
        }
        
        print(f"  [opencode] Running: opencode run --model {self.model} ...")
        print(f"  [opencode] Workspace: {self.workspace}")
        print(f"  [opencode] Prompt: {prompt[:100]}...")

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(self.workspace),
                env=env,
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=timeout,
                )
            except asyncio.TimeoutError:
                process.kill()
                await process.communicate()
                return OpenCodeResult(
                    success=False,
                    error=f"OpenCode timed out after {timeout}s",
                    latency_ms=int((time.time() - start_time) * 1000),
                )

            latency_ms = int((time.time() - start_time) * 1000)
            raw_output = stdout.decode("utf-8", errors="replace")
            stderr_text = stderr.decode("utf-8", errors="replace")

            # Save raw output to debug file for inspection
            self._save_debug_output(raw_output, raw_output)

            # Treat as failure only if exit code is non-zero AND output is empty
            if process.returncode != 0 and not raw_output.strip():
                print(f"  [opencode] ERROR (exit {process.returncode}): {stderr_text[:200]}")
                return OpenCodeResult(
                    raw_output=raw_output,
                    exit_code=process.returncode,
                    latency_ms=latency_ms,
                    success=False,
                    error=stderr_text[:500],
                )

            if process.returncode != 0:
                print(f"  [opencode] WARNING (exit {process.returncode}) but output present — continuing")

            # Parse JSONL output from --format json
            events = self._parse_jsonl(raw_output)
            tool_calls = self._extract_tool_calls(events)
            files_modified = self._extract_files(events)
            text_output = self._extract_text(events)

            self._strip_fences_from_written_files(files_modified)

            if not text_output:
                text_output = self._strip_opencode_chrome(self._strip_ansi(raw_output))

            print(f"  [opencode] Completed in {latency_ms}ms")
            print(f"  [opencode] Events: {len(events)}, Tools: {len(tool_calls)}, Files: {files_modified}")

            return OpenCodeResult(
                events=events,
                tool_calls=tool_calls,
                files_modified=files_modified,
                text_output=text_output,
                raw_output=raw_output,
                exit_code=process.returncode,
                latency_ms=latency_ms,
                success=True,
            )

        except FileNotFoundError:
            return OpenCodeResult(
                success=False,
                error="OpenCode CLI not found. Install it: curl -fsSL https://opencode.ai/install | bash",
                latency_ms=int((time.time() - start_time) * 1000),
            )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            return OpenCodeResult(
                success=False,
                error=f"Unexpected error: {str(e)}",
                latency_ms=int((time.time() - start_time) * 1000),
            )

    def _parse_jsonl(self, raw: str) -> list[dict]:
        """Parse JSONL output — one JSON object per line."""
        events = []
        for line in raw.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                events.append({"type": "text", "content": line})
        return events

    def _extract_tool_calls(self, events: list[dict]) -> list[dict]:
        """Extract tool_use events from OpenCode's JSONL stream."""
        tools = []
        for event in events:
            if event.get("type") == "tool_use":
                part = event.get("part", {})
                state = part.get("state", {})
                tools.append({
                    "tool": part.get("tool", "unknown"),
                    "status": state.get("status", ""),
                    "input": state.get("input", {}),
                    "output": str(state.get("output", ""))[:500],
                    "metadata": state.get("metadata", {}),
                })
        return tools

    def _extract_files(self, events: list[dict]) -> list[str]:
        """Extract files that were created or modified by OpenCode's write/edit tools."""
        files = set()
        for event in events:
            if event.get("type") == "tool_use":
                part = event.get("part", {})
                tool = part.get("tool", "")
                state = part.get("state", {})
                input_data = state.get("input", {})
                metadata = state.get("metadata", {})
                if tool in ("write", "edit", "create", "apply_patch"):
                    # Prefer absolute path from metadata, fall back to input field
                    path = (
                        metadata.get("filepath", "")
                        or input_data.get("filePath", "")
                        or input_data.get("file_path", "")
                        or input_data.get("path", "")
                    )
                    if path:
                        # Normalize to relative path within workspace
                        rel = path.replace(str(self.workspace) + "/", "").replace(str(self.workspace), "")
                        files.add(rel.lstrip("/") or path)
        return list(files)

    def _extract_text(self, events: list[dict]) -> str:
        """Extract the model's text response from OpenCode's JSONL output."""
        text_parts = []
        for event in events:
            event_type = event.get("type", "")
            if event_type == "text":
                part = event.get("part", {})
                if isinstance(part, dict):
                    t = part.get("text", "") or part.get("content", "")
                    if t:
                        text_parts.append(t)
            elif event_type in ("step_start", "step_finish"):
                part = event.get("part", {})
                if isinstance(part, dict) and part.get("type") == "text":
                    t = part.get("text", "") or part.get("content", "")
                    if t:
                        text_parts.append(t)
        return "\n".join(text_parts)

    def _strip_fences_from_written_files(self, files: list[str]) -> None:
        """Remove markdown code fences from files OpenCode wrote (model sometimes wraps content)."""
        fence_re = re.compile(r'^```[a-zA-Z]*\n?', re.MULTILINE)
        for rel_path in files:
            full_path = self.workspace / rel_path
            try:
                if not full_path.exists():
                    continue
                content = full_path.read_text(encoding="utf-8")
                if not content.startswith("```"):
                    continue
                # Strip opening and closing fences
                stripped = fence_re.sub("", content)
                stripped = re.sub(r'\n?```\s*$', '', stripped)
                full_path.write_text(stripped.lstrip("\n"), encoding="utf-8")
                print(f"  [opencode] Stripped markdown fences from {rel_path}")
            except Exception:
                pass

    def _strip_ansi(self, text: str) -> str:
        """Remove all ANSI escape sequences from terminal output (fallback cleaner)."""
        text = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', text)
        text = re.sub(r'\x1b[()][AB012]', '', text)
        text = re.sub(r'\x1b[=><MNOPQRSTUVWXYZ\\]', '', text)
        text = text.replace('\r', '')
        text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL)
        return text

    def _strip_opencode_chrome(self, text: str) -> str:
        """Remove OpenCode UI chrome: spinners, headers, separators, prompt markers."""
        skip_patterns = [
            re.compile(r'^\s*>\s*$'),
            re.compile(r'^\s*[─━═─\-]{3,}\s*$'),
            re.compile(r'opencode\s+v[\d\.]+', re.IGNORECASE),
            re.compile(r'^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]'),
            re.compile(r'\(esc to cancel\)', re.IGNORECASE),
            re.compile(r'^\s*>\s+[A-Z][a-z]+ing\s*\.{0,3}\s*$'),
            re.compile(r'^\s*Press\s+', re.IGNORECASE),
        ]
        lines = []
        for line in text.split('\n'):
            if not any(p.search(line) for p in skip_patterns):
                lines.append(line)
        return '\n'.join(lines)

    def _save_debug_output(self, raw: str, clean: str) -> None:
        """Save raw and cleaned output to debug files for ANSI pattern refinement."""
        try:
            debug_dir = self.workspace.parent / "output" / "debug"
            debug_dir.mkdir(parents=True, exist_ok=True)
            ts = int(time.time())
            (debug_dir / f"raw_{ts}.txt").write_bytes(raw.encode("utf-8", errors="replace"))
            (debug_dir / f"clean_{ts}.txt").write_text(clean, encoding="utf-8")
        except Exception:
            pass


    def list_workspace(self) -> dict:
        """List all files in the workspace with their sizes."""
        files = {}
        for path in sorted(self.workspace.rglob("*")):
            if path.is_file() and not path.name.startswith("."):
                rel = str(path.relative_to(self.workspace))
                files[rel] = {
                    "size_bytes": path.stat().st_size,
                    "modified": path.stat().st_mtime,
                }
        return files

    def get_workspace_summary(self) -> str:
        """Generate a human-readable workspace summary for prompt injection."""
        files = self.list_workspace()
        if not files:
            return "Workspace is empty — no files created yet."

        lines = [f"Files in workspace ({len(files)} total):"]
        for path, info in files.items():
            lines.append(f"  {path} ({info['size_bytes']} bytes)")
        return "\n".join(lines)

    def get_file_contents(self) -> dict[str, str]:
        """Read all workspace files — used for reviewer context injection."""
        contents = {}
        for path in sorted(self.workspace.rglob("*")):
            if path.is_file() and not path.name.startswith("."):
                rel = str(path.relative_to(self.workspace))
                try:
                    contents[rel] = path.read_text(encoding="utf-8")
                except Exception:
                    contents[rel] = "<binary file>"
        return contents

    def read_file(self, filepath: str) -> Optional[str]:
        """Read a single file from the workspace."""
        full_path = self.workspace / filepath
        if not full_path.exists():
            return None
        if not str(full_path.resolve()).startswith(str(self.workspace)):
            return None  # prevent path traversal
        try:
            return full_path.read_text(encoding="utf-8")
        except Exception:
            return None
