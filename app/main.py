import json
import os
from datetime import datetime
# pyrefly: ignore [missing-import]
from fastapi import FastAPI, HTTPException
from .models import TaskCreate
from .task_store import store
from .agent import agent

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "output")


def _save_output(data: dict) -> str:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filepath = os.path.join(OUTPUT_DIR, f"run_{timestamp}.json")

    def default_serializer(obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        return str(obj)

    with open(filepath, "w") as f:
        json.dump(data, f, indent=2, default=default_serializer)

    print(f"\nResults saved to: {filepath}")
    return filepath

app = FastAPI(
    title="Agentic Task Loop",
    description="A prototype agentic loop using a local LLM (Qwen 3)",
)


# ─── Task Endpoints ────────────────────────────────────────────────

@app.post("/tasks", status_code=201)
async def create_task(body: TaskCreate):
    task = store.add(body.description)
    return {"message": "Task created", "task": task}


@app.get("/tasks")
async def list_tasks():
    tasks = store.list_all()
    return {
        "tasks": tasks,
        "summary": store.summary(),
    }


@app.get("/tasks/{task_id}")
async def get_task(task_id: str):
    task = store.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    return task


# ─── Agent Endpoints ───────────────────────────────────────────────

@app.post("/agent/run")
async def run_agent():
    if agent.is_running:
        raise HTTPException(status_code=409, detail="Agent is already running")

    result = await agent.run()

    output = {
        "agent_run": result,
        "tasks": [t.dict() for t in store.list_all()],
        "summary": store.summary(),
    }
    filepath = _save_output(output)
    result["output_saved_to"] = filepath

    return result


@app.get("/agent/status")
async def agent_status():
    return {
        "is_running": agent.is_running,
        "current_task_id": agent.current_task_id,
        "total_llm_calls": agent.total_llm_calls,
        "task_summary": store.summary(),
    }


# ─── Health ─────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "service": "Agentic Task Loop Prototype",
        "status": "running",
        "task_summary": store.summary(),
        "endpoints": {
            "POST /tasks": "Add a new task",
            "GET /tasks": "List all tasks",
            "POST /agent/run": "Start the agent loop",
            "GET /agent/status": "Check agent status",
        },
    }
