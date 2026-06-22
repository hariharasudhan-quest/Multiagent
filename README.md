# Agentic Coding Agent — v2.0.0

A multi-phase agentic coding pipeline powered by **OpenCode CLI + Ollama (Qwen 3 8b)**.

## Architecture

```
Task Queue → ARCHITECT → CODER → REVIEWER → FIX (if needed) → CLOSED
```

## Pipeline Flow

1. **ARCHITECT**: Analyzes task and generates implementation plan
2. **CODER**: Writes code to workspace (up to 3 iterations)
3. **REVIEWER**: Reviews code quality and correctness
4. **FIX**: If review fails, applies fixes (up to 2 iterations)
5. Task marked CLOSED with final verdict

## Setup

### Prerequisites

- Python 3.10+
- [Ollama](https://ollama.ai/) installed and running
- Qwen 3 8B model: `ollama pull qwen3:8b`
- [OpenCode CLI](https://opencode.ai/): `curl -fsSL https://opencode.ai/install | bash`

### Install Dependencies

```bash
cd /Users/windows/Documents/Multiagent
pip install -r requirements.txt
```

### Configuration

The agent uses `opencode.json` for provider/model config. To override the model:

```bash
export OPENCODE_MODEL="ollama/qwen3:8b"
```

### Run the Server

```bash
uvicorn app.main:app --reload --port 8000
```

### Quick Demo

```bash
# 1. Add tasks
curl -X POST http://localhost:8000/tasks \
  -H "Content-Type: application/json" \
  -d '{"description": "Implement Tic-Tac-Toe in a TUI"}'

curl -X POST http://localhost:8000/tasks \
  -H "Content-Type: application/json" \
  -d '{"description": "Make the grid 5x5 instead of 3x3"}'

# 2. List all tasks
curl http://localhost:8000/tasks

# 3. Start the agent pipeline (blocks until all tasks are processed)
curl -X POST http://localhost:8000/agent/run

# 4. Check task statuses
curl http://localhost:8000/tasks

# 5. View workspace files
curl http://localhost:8000/workspace

# 6. View telemetry traces
curl http://localhost:8000/traces
```

## API Endpoints

| Method | Endpoint            | Description                        |
|--------|---------------------|------------------------------------|
| POST   | `/tasks`            | Add a new task                     |
| GET    | `/tasks`            | List all tasks with statuses       |
| GET    | `/tasks/{id}`       | Get a specific task                |
| POST   | `/agent/run`        | Start the agent pipeline           |
| GET    | `/agent/status`     | Check if the agent is running      |
| GET    | `/workspace`        | List workspace files              |
| GET    | `/workspace/{path}` | Read a workspace file             |
| GET    | `/traces`           | View telemetry traces              |
| GET    | `/traces/summary`   | View telemetry stats               |
| GET    | `/dashboard`        | Open live monitoring dashboard     |

## Example Agent Run Response

```json
{
  "status": "completed",
  "tasks_processed": 2,
  "total_opencode_runs": 8,
  "results": [
    {
      "task_id": "abc123",
      "description": "Implement Tic-Tac-Toe in a TUI",
      "status": "CLOSED",
      "files_created": ["game.py", "main.py"],
      "review_verdict": "PASS",
      "total_phases": 3,
      "plan_excerpt": "1. game.py - core game logic... 2. main.py - TUI entry point..."
    }
  ],
  "summary": {
    "total": 2,
    "open": 0,
    "in_progress": 0,
    "closed": 2
  },
  "telemetry": {
    "total_runs": 8,
    "total_latency_ms": 15420,
    "avg_latency_ms": 1927
  },
  "output_saved_to": "/Users/windows/Documents/Multiagent/output/run_20240622_120345.json"
}
```

## Project Structure

```
Multiagent/
├── app/
│   ├── agent.py          # Main pipeline logic (ARCHITECT/CODER/REVIEWER/FIX)
│   ├── main.py           # FastAPI endpoints
│   ├── models.py         # Pydantic models (Task, Trace)
│   ├── opencode_runner.py # OpenCode CLI wrapper
│   ├── task_store.py     # In-memory task storage
│   ├── telemetry.py      # Telemetry tracking
│   └── harness/          # Prompt templates for each phase
│       ├── architect.md
│       ├── coder.md
│       └── reviewer.md
├── workspace/            # Generated code output
├── output/               # Timestamped run results
├── static/               # Dashboard HTML
└── opencode.json         # OpenCode provider config
```
