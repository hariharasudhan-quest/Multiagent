"""
FastAPI application — endpoints for tasks, agent, workspace, telemetry, and dashboard.
"""

import json
import os
from datetime import datetime
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from .models import TaskCreate
from .task_store import store
from .agent import agent
from .telemetry import telemetry_store

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")
STATIC_DIR = os.path.join(PROJECT_ROOT, "static")
WORKSPACE_DIR = os.path.join(PROJECT_ROOT, "workspace")


def _save_output(data: dict) -> str:
    """Save run results to output/ as timestamped JSON."""
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
    title="Agentic Coding Agent",
    description="A prototype agentic coding agent using OpenCode + Ollama (Qwen 3)",
    version="2.0.0",
)


# ─── Task Endpoints ────────────────────────────────────────────────

@app.post("/tasks", status_code=201)
async def create_task(body: TaskCreate):
    """Create a new coding task."""
    task = store.add(body.description)
    return {"message": "Task created", "task": task}


@app.get("/tasks")
async def list_tasks():
    """List all tasks with summary."""
    tasks = store.list_all()
    return {
        "tasks": tasks,
        "summary": store.summary(),
    }


@app.get("/tasks/{task_id}")
async def get_task(task_id: str):
    """Get a specific task with all details."""
    task = store.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    return task


# ─── Agent Endpoints ───────────────────────────────────────────────

@app.post("/agent/run")
async def run_agent():
    """
    Start the agent pipeline: ARCHITECT → CODER → REVIEWER → FIX.
    Processes all OPEN tasks sequentially.
    """
    if agent.is_running:
        raise HTTPException(status_code=409, detail="Agent is already running")

    result = await agent.run()

    output = {
        "agent_run": result,
        "tasks": [t.dict() for t in store.list_all()],
        "summary": store.summary(),
        "telemetry": telemetry_store.summary(),
    }
    filepath = _save_output(output)
    result["output_saved_to"] = filepath

    return result


@app.get("/agent/status")
async def agent_status():
    """Check what the agent is currently doing."""
    return {
        "is_running": agent.is_running,
        "current_task_id": agent.current_task_id,
        "current_phase": agent.current_phase,
        "total_opencode_runs": agent.total_opencode_runs,
        "task_summary": store.summary(),
    }


# ─── Workspace Endpoints ──────────────────────────────────────────

@app.get("/workspace")
async def list_workspace():
    """List all files in the agent's workspace."""
    files = agent.runner.list_workspace()
    return {
        "workspace_dir": str(agent.runner.workspace),
        "files": files,
        "total_files": len(files),
    }


@app.get("/workspace/{filepath:path}")
async def read_workspace_file(filepath: str):
    """Read a specific file from the workspace."""
    content = agent.runner.read_file(filepath)
    if content is None:
        raise HTTPException(status_code=404, detail=f"File not found: {filepath}")
    return PlainTextResponse(content)


# ─── Telemetry Endpoints ──────────────────────────────────────────

@app.get("/traces")
async def get_traces(task_id: str = None):
    """Get all telemetry traces, optionally filtered by task_id."""
    if task_id:
        traces = telemetry_store.get_by_task(task_id)
    else:
        traces = telemetry_store.get_all()
    return {
        "traces": [t.dict() for t in traces],
        "count": len(traces),
    }


@app.get("/traces/summary")
async def get_traces_summary():
    """Get aggregated telemetry stats."""
    return telemetry_store.summary()


# ─── Dashboard ─────────────────────────────────────────────────────

@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard():
    """Serve the live monitoring dashboard."""
    dashboard_path = os.path.join(STATIC_DIR, "dashboard.html")
    if not os.path.exists(dashboard_path):
        raise HTTPException(status_code=404, detail="Dashboard not found. Create static/dashboard.html")
    with open(dashboard_path, "r") as f:
        return HTMLResponse(content=f.read())


# ─── Health ─────────────────────────────────────────────────────────

@app.get("/")
async def root():
    """Service health and endpoint listing."""
    return {
        "service": "Agentic Coding Agent",
        "version": "2.0.0",
        "runtime": "OpenCode + Ollama (Qwen 3)",
        "status": "running",
        "task_summary": store.summary(),
        "endpoints": {
            "POST /tasks": "Create a coding task",
            "GET /tasks": "List all tasks",
            "GET /tasks/{id}": "Get task details",
            "POST /agent/run": "Start the agent pipeline",
            "GET /agent/status": "Check agent status",
            "GET /workspace": "List workspace files",
            "GET /workspace/{path}": "Read a workspace file",
            "GET /traces": "View telemetry traces",
            "GET /traces/summary": "View telemetry stats",
            "GET /dashboard": "Open live dashboard",
        },
    }
