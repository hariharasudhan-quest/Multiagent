from datetime import datetime
from typing import Optional
from .models import Trace


class TelemetryStore:

    def __init__(self):
        self._traces: list[Trace] = []

    def record(
        self,
        task_id: str,
        mode: str,
        latency_ms: int,
        tool_calls: list[dict],
        files_modified: list[str],
        text_output: str = "",
        success: bool = True,
        error: str = "",
        model: str = "ollama/qwen3:8b",
        event_count: int = 0,
    ) -> Trace:
        """Record a trace for a single OpenCode invocation."""
        trace = Trace(
            task_id=task_id,
            mode=mode,
            model=model,
            latency_ms=latency_ms,
            tool_calls=tool_calls,
            files_modified=files_modified,
            event_count=event_count,
            text_output=text_output[:2000],  # cap stored text
            success=success,
            error=error,
        )
        self._traces.append(trace)

        status = "✓" if success else "✗"
        print(f"  [telemetry] {status} {mode} | {latency_ms}ms | {len(tool_calls)} tools | {files_modified}")

        return trace

    def get_all(self) -> list[Trace]:
        """Get all traces."""
        return list(self._traces)

    def get_by_task(self, task_id: str) -> list[Trace]:
        """Get traces for a specific task."""
        return [t for t in self._traces if t.task_id == task_id]

    def summary(self) -> dict:
        """Aggregated telemetry stats."""
        if not self._traces:
            return {
                "total_runs": 0,
                "total_tool_calls": 0,
                "total_files_modified": 0,
                "avg_latency_ms": 0,
                "total_latency_ms": 0,
                "success_rate": 0,
                "calls_by_mode": {},
            }

        total_tool_calls = sum(len(t.tool_calls) for t in self._traces)
        all_files = set()
        for t in self._traces:
            all_files.update(t.files_modified)
        total_latency = sum(t.latency_ms for t in self._traces)
        successful = sum(1 for t in self._traces if t.success)

        mode_counts: dict[str, int] = {}
        mode_latency: dict[str, int] = {}
        for t in self._traces:
            mode_counts[t.mode] = mode_counts.get(t.mode, 0) + 1
            mode_latency[t.mode] = mode_latency.get(t.mode, 0) + t.latency_ms

        return {
            "total_runs": len(self._traces),
            "total_tool_calls": total_tool_calls,
            "total_files_modified": len(all_files),
            "files_list": sorted(all_files),
            "avg_latency_ms": total_latency // len(self._traces),
            "total_latency_ms": total_latency,
            "success_rate": round(successful / len(self._traces) * 100, 1),
            "calls_by_mode": mode_counts,
            "latency_by_mode": {
                k: v // mode_counts[k] for k, v in mode_latency.items()
            },
        }


telemetry_store = TelemetryStore()
