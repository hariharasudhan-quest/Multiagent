from typing import Optional
from .models import Task, TaskStatus
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

    def record_iteration(self, task_id: str, llm_output: str) -> None:
        task = self._tasks[task_id]
        task.iterations += 1
        task.llm_outputs.append(llm_output)

    def summary(self) -> dict:
        tasks = self.list_all()
        return {
            "total": len(tasks),
            "open": sum(1 for t in tasks if t.status == TaskStatus.OPEN),
            "in_progress": sum(1 for t in tasks if t.status == TaskStatus.IN_PROGRESS),
            "closed": sum(1 for t in tasks if t.status == TaskStatus.CLOSED),
        }


store = TaskStore()
