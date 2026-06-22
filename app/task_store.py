from typing import Optional, List
from .models import Task, TaskStatus, TaskPhase
from datetime import datetime


class TaskStore:

    def __init__(self):
        self._tasks: dict[str, Task] = {}

    def add(self, description: str) -> Task:
        task = Task(description=description)
        self._tasks[task.id] = task
        return task

    def get(self, task_id: str) -> Optional[Task]:
        return self._tasks.get(task_id)

    def list_all(self) -> list[Task]:
        return sorted(self._tasks.values(), key=lambda t: t.created_at)

    def next_open(self) -> Optional[Task]:
        for task in self.list_all():
            if task.status == TaskStatus.OPEN:
                return task
        return None

    def mark_in_progress(self, task_id: str) -> None:
        task = self._tasks[task_id]
        task.status = TaskStatus.IN_PROGRESS

    def mark_closed(self, task_id: str) -> None:
        task = self._tasks[task_id]
        task.status = TaskStatus.CLOSED
        task.closed_at = datetime.utcnow()

    def set_phase(self, task_id: str, phase: TaskPhase) -> None:
        task = self._tasks[task_id]
        task.phase = phase

    def set_plan(self, task_id: str, plan: str) -> None:
        task = self._tasks[task_id]
        task.plan = plan

    def set_review(self, task_id: str, verdict: str, details: str) -> None:
        task = self._tasks[task_id]
        task.review_verdict = verdict
        task.review_details = details

    def add_file(self, task_id: str, filepath: str) -> None:
        task = self._tasks[task_id]
        if filepath not in task.files_created:
            task.files_created.append(filepath)

    def record_phase_output(self, task_id: str, phase: str, output: dict) -> None:
        task = self._tasks[task_id]
        task.iterations += 1
        task.phase_outputs.append({"phase": phase, **output})

    def summary(self) -> dict:
        tasks = self.list_all()
        return {
            "total": len(tasks),
            "open": sum(1 for t in tasks if t.status == TaskStatus.OPEN),
            "in_progress": sum(1 for t in tasks if t.status == TaskStatus.IN_PROGRESS),
            "closed": sum(1 for t in tasks if t.status == TaskStatus.CLOSED),
        }


store = TaskStore()
