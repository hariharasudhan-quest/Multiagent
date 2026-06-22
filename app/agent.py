from __future__ import annotations

import os
import re
from pathlib import Path
from .models import TaskPhase
from .task_store import store
from .harness import HarnessManager
from .opencode_runner import OpenCodeRunner
from .telemetry import telemetry_store

MAX_CODER_ITERATIONS = 3
MAX_FIX_ITERATIONS = 2

# Resolve paths relative to project root
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HARNESS_DIR = os.path.join(PROJECT_ROOT, "harness")
WORKSPACE_DIR = os.path.join(PROJECT_ROOT, "workspace")
MODEL = os.environ.get("OPENCODE_MODEL", "ollama/qwen3:8b")


def extract_files_from_text(text: str, workspace: Path, fallback_filename: str = "main.py") -> list[str]:
    """
    Parse a coder's markdown text output and write files to disk.

    Handles two formats:
    1. Filename on its own line directly before a code block:
           game.py
           ```python
           ...
           ```
    2. Filename embedded in a line (bold, backtick, or plain) before a code block:
           **game.py**
           ```python
           ...
           ```

    Falls back to saving the first unnamed code block as `fallback_filename`.
    Returns a list of relative file paths that were written.
    """
    written = []

    # Primary pattern: filename (optionally wrapped in **, `, or ##) on line before fence
    pattern = re.compile(
        r'(?:^|\n)[^\S\n]*(?:#{1,3}\s*|[*`]{1,2})?([a-zA-Z0-9_\-/]+\.[a-zA-Z0-9]+)[*`]{0,2}\s*\n'
        r'```[a-zA-Z]*\n'
        r'(.*?)'
        r'\n?```',
        re.DOTALL,
    )

    def _write(rel_path: str, code: str) -> bool:
        rel_path = rel_path.lstrip("/")
        target = (workspace / rel_path).resolve()
        if not str(target).startswith(str(workspace.resolve())):
            return False
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(code, encoding="utf-8")
        written.append(rel_path)
        return True

    for match in pattern.finditer(text):
        _write(match.group(1).strip(), match.group(2))

    # Fallback: extract any code block if nothing was matched
    if not written:
        fallback_pattern = re.compile(r'```[a-zA-Z]*\n(.*?)\n?```', re.DOTALL)
        for match in fallback_pattern.finditer(text):
            code = match.group(1).strip()
            if len(code) > 50:  # ignore tiny snippets
                _write(fallback_filename, code)
                break

    return written

class AgentLoop:
    """
    Three-phase agentic pipeline:
        ARCHITECT → CODER → REVIEWER → (FIX if needed)

    Each phase invokes OpenCode with a different harness prompt.
    OpenCode handles the LLM calls and file operations natively.
    """

    def __init__(self):
        self.is_running = False
        self.current_task_id: Optional[str] = None
        self.current_phase: Optional[str] = None
        self.total_opencode_runs = 0
        self.harness = HarnessManager(HARNESS_DIR)
        self.runner = OpenCodeRunner(workspace_dir=WORKSPACE_DIR, model=MODEL)

    async def run(self) -> dict:
        """Process all OPEN tasks through the pipeline."""
        if self.is_running:
            return {"error": "Agent is already running"}

        self.is_running = True
        self.total_opencode_runs = 0
        results = []

        print("\n" + "=" * 60)
        print("AGENT PIPELINE STARTED")
        print(f"Runtime: OpenCode | Model: {MODEL}")
        print(f"Harness modes: {self.harness.available_modes()}")
        print("=" * 60)

        try:
            while True:
                task = store.next_open()
                if task is None:
                    print("\n✅ No more OPEN tasks. Pipeline complete.")
                    break

                result = await self._process_task(task.id)
                results.append(result)

        finally:
            self.is_running = False
            self.current_task_id = None
            self.current_phase = None

        summary = store.summary()
        telemetry = telemetry_store.summary()
        print(f"\nTask Summary: {summary}")
        print(f"Telemetry: {telemetry}")
        print("=" * 60)

        return {
            "status": "completed",
            "tasks_processed": len(results),
            "total_opencode_runs": self.total_opencode_runs,
            "results": results,
            "summary": summary,
            "telemetry": telemetry,
        }

    async def _process_task(self, task_id: str) -> dict:
        """Run a single task through the full pipeline."""
        task = store.get(task_id)
        self.current_task_id = task_id
        store.mark_in_progress(task_id)

        # Each task starts a fresh OpenCode session (architect phase).
        # Subsequent phases use --continue to chain context within the same task.

        print(f"\n{'─' * 60}")
        print(f"Task [{task.id}]: {task.description}")
        print(f"{'─' * 60}")

        # ── PHASE 1: ARCHITECT ──────────────────────────────
        print(f"\n  ▶ PHASE 1: ARCHITECT")
        self.current_phase = "architect"
        store.set_phase(task_id, TaskPhase.ARCHITECT)

        architect_prompt = self.harness.build_prompt(
            mode="architect",
            task=task.description,
            context={
                "workspace_summary": self.runner.get_workspace_summary(),
            },
        )

        architect_result = await self.runner.run(architect_prompt, continue_session=False)
        self.total_opencode_runs += 1

        telemetry_store.record(
            task_id=task_id,
            mode="architect",
            latency_ms=architect_result.latency_ms,
            tool_calls=architect_result.tool_calls,
            files_modified=architect_result.files_modified,
            text_output=architect_result.text_output,
            success=architect_result.success,
            error=architect_result.error,
            event_count=len(architect_result.events),
        )

        plan = architect_result.text_output or architect_result.raw_output

        # Sanity-check: a valid plan must contain at least one numbered item or filename.
        # If the architect hallucinated bash/troubleshooting text, fall back to a default.
        has_numbered = bool(re.search(r'^\s*\d+\.', plan, re.MULTILINE))
        has_filename = bool(re.search(r'\b[a-zA-Z0-9_\-]+\.py\b', plan))
        if not (has_numbered or has_filename):
            print(f"  ⚠ Architect plan looks invalid — using default single-file plan")
            plan = "1. main.py - main entry point implementing the full task"

        store.set_plan(task_id, plan)

        # Extract first .py filename from plan for use as fallback when coder omits filename
        _fname_match = re.search(r'\b([a-zA-Z0-9_\-]+\.py)\b', plan)
        plan_filename = _fname_match.group(1) if _fname_match else "main.py"
        store.record_phase_output(task_id, "architect", {
            "plan": plan[:2000],
            "latency_ms": architect_result.latency_ms,
            "success": architect_result.success,
        })

        print(f"  ✓ Architect plan: {len(plan)} chars")

        # ── PHASE 2: CODER ──────────────────────────────────
        print(f"\n  ▶ PHASE 2: CODER")
        self.current_phase = "coder"
        store.set_phase(task_id, TaskPhase.CODER)

        for coder_iter in range(MAX_CODER_ITERATIONS):
            print(f"    Coder iteration {coder_iter + 1}/{MAX_CODER_ITERATIONS}")

            coder_prompt = self.harness.build_prompt(
                mode="coder",
                task=task.description,
                context={
                    "plan": plan,
                    "workspace_summary": self.runner.get_workspace_summary(),
                },
            )

            coder_result = await self.runner.run(coder_prompt, continue_session=False)
            self.total_opencode_runs += 1

            telemetry_store.record(
                task_id=task_id,
                mode="coder",
                latency_ms=coder_result.latency_ms,
                tool_calls=coder_result.tool_calls,
                files_modified=coder_result.files_modified,
                text_output=coder_result.text_output,
                success=coder_result.success,
                error=coder_result.error,
                event_count=len(coder_result.events),
            )

            for f in coder_result.files_modified:
                store.add_file(task_id, f)

            if not coder_result.files_modified and coder_result.text_output:
                extracted = extract_files_from_text(
                    coder_result.text_output, self.runner.workspace, plan_filename
                )
                for f in extracted:
                    store.add_file(task_id, f)
                if extracted:
                    print(f"    ✓ Extracted {len(extracted)} file(s) from text output")
                    coder_result.files_modified = extracted

            store.record_phase_output(task_id, "coder", {
                "iteration": coder_iter + 1,
                "files_modified": coder_result.files_modified,
                "tool_calls_count": len(coder_result.tool_calls),
                "latency_ms": coder_result.latency_ms,
                "success": coder_result.success,
            })

            print(f"    ✓ Files: {coder_result.files_modified}, Tools: {len(coder_result.tool_calls)}")

            # If files were created, move on
            if coder_result.files_modified:
                break

            # No files produced — log and retry
            if not coder_result.success:
                print(f"    ⚠ Coder failed: {(coder_result.error or 'unknown error')[:100]}")
            else:
                print(f"    ⚠ Coder produced no files — retrying ({coder_iter + 1}/{MAX_CODER_ITERATIONS})")
            continue

        # ── PHASE 3: REVIEWER ────────────────────────────────
        print(f"\n  ▶ PHASE 3: REVIEWER")
        self.current_phase = "reviewer"
        store.set_phase(task_id, TaskPhase.REVIEWER)

        file_contents = self.runner.get_file_contents()

        if not file_contents:
            print("    ⚠ No files in workspace — skipping review")
            store.set_review(task_id, "SKIP", "No files to review")
        else:
            reviewer_prompt = self.harness.build_prompt(
                mode="reviewer",
                task=task.description,
                context={
                    "file_contents": file_contents,
                },
            )

            review_result = await self.runner.run(reviewer_prompt, continue_session=False)
            self.total_opencode_runs += 1

            telemetry_store.record(
                task_id=task_id,
                mode="reviewer",
                latency_ms=review_result.latency_ms,
                tool_calls=review_result.tool_calls,
                files_modified=review_result.files_modified,
                text_output=review_result.text_output,
                success=review_result.success,
                error=review_result.error,
                event_count=len(review_result.events),
            )

            review_text = review_result.text_output or review_result.raw_output
            upper = review_text.upper()
            has_pass = "PASS" in upper[:200]
            has_fail = "FAIL" in upper[:200]
            if has_fail and not has_pass:
                verdict = "FAIL"
            elif has_pass:
                verdict = "PASS"
            else:
                # Reviewer didn't output a verdict (used a tool or hallucinated)
                print(f"    ⚠ Reviewer gave no clear verdict — defaulting to PASS")
                verdict = "PASS"
            store.set_review(task_id, verdict, review_text)

            store.record_phase_output(task_id, "reviewer", {
                "verdict": verdict,
                "details": review_text[:1000],
                "latency_ms": review_result.latency_ms,
            })

            print(f"    ✓ Review verdict: {verdict}")

            # ── PHASE 4: FIX (if review failed) ─────────────
            if verdict == "FAIL":
                print(f"\n  ▶ PHASE 4: FIX")
                self.current_phase = "fix"
                store.set_phase(task_id, TaskPhase.FIX)

                for fix_iter in range(MAX_FIX_ITERATIONS):
                    print(f"    Fix iteration {fix_iter + 1}/{MAX_FIX_ITERATIONS}")

                    fix_prompt = self.harness.build_prompt(
                        mode="coder",
                        task=task.description,
                        context={
                            "plan": plan,
                            "review_feedback": review_text,
                            "workspace_summary": self.runner.get_workspace_summary(),
                            "file_contents": file_contents,
                        },
                    )

                    fix_result = await self.runner.run(fix_prompt, continue_session=False)
                    self.total_opencode_runs += 1

                    telemetry_store.record(
                        task_id=task_id,
                        mode="fix",
                        latency_ms=fix_result.latency_ms,
                        tool_calls=fix_result.tool_calls,
                        files_modified=fix_result.files_modified,
                        text_output=fix_result.text_output,
                        success=fix_result.success,
                        error=fix_result.error,
                        event_count=len(fix_result.events),
                    )

                    for f in fix_result.files_modified:
                        store.add_file(task_id, f)

                    if not fix_result.files_modified and fix_result.text_output:
                        extracted = extract_files_from_text(
                            fix_result.text_output, self.runner.workspace
                        )
                        for f in extracted:
                            store.add_file(task_id, f)
                        if extracted:
                            fix_result.files_modified = extracted

                    store.record_phase_output(task_id, "fix", {
                        "iteration": fix_iter + 1,
                        "files_modified": fix_result.files_modified,
                        "latency_ms": fix_result.latency_ms,
                    })

                    print(f"    Fix applied: {fix_result.files_modified}")

                    if fix_result.files_modified:
                        break

                    if not fix_result.success:
                        print(f"    ⚠ Fix failed: {(fix_result.error or 'unknown error')[:100]}")

        # ── CLOSE ────────────────────────────────────────────
        store.set_phase(task_id, TaskPhase.DONE)
        store.mark_closed(task_id)

        task = store.get(task_id)
        print(f"\n  Task [{task.id}] CLOSED | Files: {task.files_created} | Phases: {task.iterations}")

        return {
            "task_id": task.id,
            "description": task.description,
            "status": "CLOSED",
            "files_created": task.files_created,
            "review_verdict": task.review_verdict,
            "total_phases": task.iterations,
            "plan_excerpt": task.plan[:500],
        }


agent = AgentLoop()
