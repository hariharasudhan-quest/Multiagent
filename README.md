# 🤖 Agentic Task Loop — Local LLM Prototype

A minimal proof-of-concept demonstrating an **agentic task loop** powered by a local LLM (Qwen via Ollama).

## Architecture

```
Task Queue → Local LLM (Qwen/Ollama) → Decision → Task State Update → Next Task
```

## Flow

1. Tasks are submitted via API with status `OPEN`
2. The agent loop picks the next `OPEN` task
3. Sends task + context to the local Qwen model via Ollama
4. LLM responds with structured JSON (`CONTINUE_TASK` or `CLOSE_TASK`)
5. Task state is updated accordingly
6. Loop continues until no `OPEN` tasks remain

## Setup

### Prerequisites

- Python 3.10+
- [Ollama](https://ollama.ai/) installed and running
- Qwen model pulled: `ollama pull qwen3:1.7b`

### Install Dependencies

```bash
cd /Users/windows/Documents/prototype
pip install -r requirements.txt
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

curl -X POST http://localhost:8000/tasks \
  -H "Content-Type: application/json" \
  -d '{"description": "Make the grid size configurable"}'

curl -X POST http://localhost:8000/tasks \
  -H "Content-Type: application/json" \
  -d '{"description": "Make the player count configurable instead of fixed 2 players"}'

# 2. List all tasks
curl http://localhost:8000/tasks

# 3. Start the agent loop (blocks until all tasks are processed)
curl -X POST http://localhost:8000/agent/run

# 4. Check task statuses
curl http://localhost:8000/tasks
```

## API Endpoints

| Method | Endpoint         | Description                        |
|--------|------------------|------------------------------------|
| POST   | `/tasks`         | Add a new task                     |
| GET    | `/tasks`         | List all tasks with statuses       |
| GET    | `/tasks/{id}`    | Get a specific task                |
| POST   | `/agent/run`     | Start the agent loop               |
| GET    | `/agent/status`  | Check if the agent is running      |

## Example LLM Response

```json
{
  "action": "CLOSE_TASK",
  "reasoning": "The task to implement Tic-Tac-Toe in a TUI has been analyzed. The implementation would require...",
  "output": "Implementation plan: 1. Create a 3x3 grid... 2. Handle player input..."
}
```
