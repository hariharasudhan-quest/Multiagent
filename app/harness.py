from pathlib import Path
from typing import Optional


class HarnessManager:

    def __init__(self, harness_dir: str):
        self.harness_dir = Path(harness_dir)
        self.modes: dict[str, str] = {}
        self._load_all()

    def _load_all(self) -> None:
        """Load all .md harness files from the harness directory."""
        if not self.harness_dir.exists():
            print(f"  [harness] WARNING: {self.harness_dir} does not exist")
            return

        for md_file in sorted(self.harness_dir.glob("*.md")):
            mode = md_file.stem
            self.modes[mode] = md_file.read_text(encoding="utf-8")
            print(f"  [harness] Loaded mode: {mode} ({len(self.modes[mode])} chars)")

    def get_system_prompt(self, mode: str) -> str:
        """Get the raw harness prompt for a mode."""
        if mode not in self.modes:
            raise ValueError(f"Unknown harness mode: {mode}. Available: {list(self.modes.keys())}")
        return self.modes[mode]

    def build_prompt(
        self,
        mode: str,
        task: str,
        context: Optional[dict] = None,
    ) -> str:
        """
        Build a full prompt by combining harness instructions + task + context.

        The prompt structure mirrors how real coding agents (aider, Cursor)
        inject context:

            [HARNESS INSTRUCTIONS]
            (contents of mode.md)

            [TASK]
            (task description)

            [WORKSPACE STATE]   (optional)
            (list of files in workspace)

            [ARCHITECT PLAN]    (optional, for coder mode)
            (plan from architect phase)

            [REVIEW FEEDBACK]   (optional, for fix mode)
            (issues from reviewer)

            [FILE CONTENTS]     (optional, for reviewer mode)
            (actual file contents)
        """
        harness_content = self.get_system_prompt(mode)
        context = context or {}

        # /no_think must be the very first token Qwen3 sees to reliably suppress
        # chain-of-thought. If it appears anywhere else, Qwen3 may still emit
        # <think> blocks which deadlock Ollama's JSON grammar parser.
        parts = ["/no_think"]
        parts.append(harness_content)
        parts.append(f"\n---\n\n[TASK]\n{task}")

        if context.get("workspace_summary"):
            parts.append(f"\n[WORKSPACE STATE]\n{context['workspace_summary']}")

        if context.get("plan"):
            parts.append(f"\n[ARCHITECT PLAN]\n{context['plan']}")

        if context.get("review_feedback"):
            parts.append(f"\n[REVIEW FEEDBACK]\nThe reviewer found issues. Fix them:\n{context['review_feedback']}")

        if context.get("file_contents"):
            parts.append("\n[FILE CONTENTS]")
            for filepath, content in context["file_contents"].items():
                parts.append(f"\n{filepath}\n```\n{content}\n```")

        return "\n".join(parts)

    def available_modes(self) -> list[str]:
        """List all loaded harness modes."""
        return list(self.modes.keys())
