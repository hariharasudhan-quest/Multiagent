from __future__ import annotations

import asyncio
from typing import Optional
from .models import LLMAction, TaskStatus
from .task_store import store
from .ollama_client import call_ollama, build_task_prompt, MAX_ITERATIONS_PER_TASK


class AgentLoop:
    """
    The agentic loop that processes tasks using a local LLM.

    Flow:
        1. Find next OPEN task
        2. Mark it IN_PROGRESS
        3. Send task + context to LLM
        4. Parse structured JSON response
        5. If CLOSE_TASK → mark CLOSED, move to next
        6. If CONTINUE_TASK → iterate (up to max)
        7. Repeat until no OPEN tasks
    """

    def __init__(self):
        self.is_running = False
        self.current_task_id: Optional[str] = None
        self.total_llm_calls = 0

    async def run(self) -> dict:
        if self.is_running:
            return {"error": "Agent is already running"}

        self.is_running = True
        self.total_llm_calls = 0
        results = []

        print("\n" + "=" * 60)
        print("AGENT LOOP STARTED")
        print("=" * 60)

        try:
            while True:
                task = store.next_open()
                if task is None:
                    print("\n✅ No more OPEN tasks. Agent loop complete.")
                    break

                result = await self._process_task(task.id)
                results.append(result)

        finally:
            self.is_running = False
            self.current_task_id = None

        summary = store.summary()
        print(f"\nFinal Summary: {summary}")
        print("=" * 60)

        return {
            "status": "completed",
            "tasks_processed": len(results),
            "total_llm_calls": self.total_llm_calls,
            "results": results,
            "summary": summary,
        }

    async def _process_task(self, task_id: str) -> dict:
        task = store.get(task_id)
        self.current_task_id = task_id
        store.mark_in_progress(task_id)

        print(f"\n{'─' * 50}")
        print(f"Processing Task [{task.id}]: {task.description}")
        print(f"{'─' * 50}")

        for iteration in range(MAX_ITERATIONS_PER_TASK):
            print(f"\n  Iteration {iteration + 1}/{MAX_ITERATIONS_PER_TASK}")

            prompt = build_task_prompt(
                task_description=task.description,
                iteration=iteration,
                previous_outputs=task.llm_outputs,
            )

            llm_response = await call_ollama(prompt)
            self.total_llm_calls += 1

            store.record_iteration(task_id, llm_response.output)

            print(f"  Action: {llm_response.action.value}")
            print(f"  Reasoning: {llm_response.reasoning[:100]}...")

            if llm_response.action == LLMAction.CLOSE_TASK:
                store.mark_closed(task_id)
                print(f"  Task [{task.id}] CLOSED after {iteration + 1} iteration(s)")
                return {
                    "task_id": task.id,
                    "description": task.description,
                    "status": "CLOSED",
                    "iterations": iteration + 1,
                    "final_output": llm_response.output,
                }

            print(f"  Continuing task...")
            await asyncio.sleep(0.5)

        store.mark_closed(task_id)
        print(f"  Task [{task.id}] force-CLOSED after {MAX_ITERATIONS_PER_TASK} iterations")
        return {
            "task_id": task.id,
            "description": task.description,
            "status": "CLOSED (max iterations)",
            "iterations": MAX_ITERATIONS_PER_TASK,
            "final_output": task.llm_outputs[-1] if task.llm_outputs else "",
        }


agent = AgentLoop()
