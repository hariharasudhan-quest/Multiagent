# agent-ts

A TypeScript Express backend for dynamic agent selection and conversational AI using the OpenCode SDK and Ollama. Includes a built-in chat UI, session reuse with memory, and an LLM traffic proxy for debugging.

---

## Prerequisites

- **Node.js** (v20+)
- **Ollama** running locally (default model: `qwen3:8b`)
- **OpenCode** server running on port `4096`

---

## Quick Start

```bash
# Install dependencies
npm install

# Build (type-check only, no emit)
npm run build

# Start the backend
npm start          # Runs on http://localhost:3000

# (Optional) Start the LLM proxy logger
npm run proxy      # Runs on http://localhost:8080
```

---

## Project Structure

```
agent-ts/
├── src/
│   ├── types.ts       # TypeScript interfaces
│   ├── store.ts       # In-memory data store
│   ├── runner.ts      # OpenCode SDK integration
│   ├── index.ts       # Express API server
│   ├── proxy.ts       # LLM traffic logger
│   └── pipeline.ts    # Legacy task wrapper
├── public/
│   └── index.html     # Chat UI (single-page, no build)
├── package.json
├── tsconfig.json
└── .gitignore
```

---

## File Explanations

### `src/types.ts`

Defines all data structures used across the app:

- `Task` / `TaskStatus` — Legacy task objects with phases.
- `PhaseResult` — Result of one agent run (output, tokens, latency, files).
- `HistoryTurn` — A single chat turn (`user` or `assistant` + text).
- `SessionRecord` — Chat session metadata + full conversation `history[]`.
- `TraceEvent` — Raw events from the OpenCode SDK event stream.

### `src/store.ts`

In-memory singleton (`TaskStore`) for runtime state:

| Method | Purpose |
|--------|---------|
| `create(description)` | Create a legacy task. |
| `addSession(session)` | Initialize a new session with empty `history`. |
| `addToSessionHistory(id, role, text)` | Append a chat turn to a session. |
| `getSession(id)` / `listSessions()` | Retrieve session data. |
| `updateSessionAgent(id, agent)` | Switch the agent for a session. |
| `addTrace(event)` | Store OpenCode SDK events (capped at 2000). |

### `src/runner.ts`

Core agent execution logic:

1. **`getClient()`** — Lazily connects to the OpenCode server (`http://127.0.0.1:4096`) via `createOpencodeClient`. Starts an event stream once.
2. **`startEventStream()`** — Subscribes to OpenCode events and logs them to the store.
3. **`runAgent(agentName, prompt, existingSessionId?)`** — The main runner:
   - Creates or reuses an OpenCode session.
   - Stores the user prompt in local history.
   - **Builds a full conversation context** from all previous turns (`User: …\n\nAssistant: …`).
   - Sends the contextualized prompt to the agent via `client.session.prompt()`.
   - Parses the response, stores the assistant reply, and returns a `RunResult`.
4. **`extractText()` / `extractFiles()`** — Parse OpenCode `Part` arrays for display and file tracking.

### `src/index.ts`

Express server (port `3000`):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health/docs — lists all endpoints. |
| `/run` | POST | Main endpoint. Body: `{ agent, prompt, sessionId? }`. Returns full agent output. |
| `/sessions` | GET | List all active sessions with history. |
| `/sessions/:id` | GET | Get a single session by ID. |
| `/agents` | GET | List all OpenCode agents. |
| `/subagents` | GET | List only subagents (`mode === "subagent"`). |
| `/traces` | GET | Get captured OpenCode event traces. |
| `/tasks` | POST/GET | Legacy task API (still functional). |

Also serves `public/index.html` as the chat UI.

### `src/proxy.ts`

Standalone HTTP proxy (port `8080`) for debugging LLM traffic:

- Intercepts every request/response between the app and the LLM/Ollama server.
- Forwards transparently with original headers and body.
- Logs structured entries to `logs/raw_traffic.jsonl` (timestamp, method, target URL, request body, response body, status, latency).
- Useful for inspecting exactly what the LLM receives and returns.

Set `PROXY_TARGET` to point it at your LLM server (default: `http://localhost:11434`).

### `src/pipeline.ts`

Legacy adapter from the old fixed-pipeline system:

- `runSingleAgent(taskId, agentName, extraContext?)` — Wraps `runAgent` for legacy tasks.
- Converts `RunResult` → `PhaseResult` for storage.

### `public/index.html`

Single-page chat UI (vanilla JS, no build step):

- **Sidebar** — Agent selector (fetches `/agents`, groups by `primary` / `subagent` / `other`). Shows current `sessionId` and a **New Session** button.
- **Chat area** — Message bubbles. User (blue, right), Assistant (dark, left).
- **Input** — Auto-resizing textarea. `Enter` sends, `Shift+Enter` for newline.
- **Logic** — `sendMessage()` POSTs to `/run` with the current `sessionId`. Reuses the same `sessionId` across turns so the backend maintains conversation history.

---

## Workflow

### 1. Agent Selection

The UI loads agents from `GET /agents` on startup. Agents are grouped by `mode`:
- **Primary** — Main agents (e.g., `architect`, `coder`).
- **Subagents** — Utility agents (e.g., `ask`, `explore`, `reviewer`).

### 2. Starting a Session

When you send your first message:
1. UI calls `POST /run` with `{ agent, prompt }` (no `sessionId`).
2. Backend creates a new OpenCode session via `client.session.create()`.
3. Session metadata is stored in `TaskStore` with an empty `history[]`.
4. Your prompt is added to history.
5. The prompt is sent to the agent with full model config (`ollama/qwen3:8b`).
6. The assistant response is stored in history.
7. The UI displays the response and saves the returned `sessionId`.

### 3. Conversational Memory

On follow-up messages in the same session:
1. UI calls `POST /run` with `{ agent, prompt, sessionId }`.
2. Backend reuses the existing OpenCode session.
3. The new prompt is appended to session history.
4. **All previous turns are concatenated** into a context string and prepended to the prompt.
5. The agent receives the full conversation history, enabling context-aware replies.

### 4. Session Management

- **New Session** button in the UI clears the local `sessionId`, causing the next message to create a fresh session.
- Old sessions remain in the backend store and can be retrieved via `GET /sessions/:id`.

### 5. Debugging

- **Traces** — OpenCode SDK events are captured in real-time. View via `GET /traces`.
- **Proxy** — Run `npm run proxy` to log all raw LLM request/response traffic to `logs/raw_traffic.jsonl`.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | agent-ts server port. |
| `OPENCODE_URL` | `http://127.0.0.1:4096` | OpenCode server URL. |
| `OPENCODE_MODEL_ID` | `qwen3:8b` | Ollama model to use. |
| `PROXY_TARGET` | `http://localhost:11434` | LLM server target for proxy. |
| `PROXY_PORT` | `8080` | Proxy server port. |

---

## Tech Stack

- **Runtime**: Node.js 20+ (ES Modules)
- **Language**: TypeScript 5.5
- **Framework**: Express 4
- **SDK**: `@opencode-ai/sdk`
- **LLM**: Ollama (`qwen3:8b`)
- **Execution**: `tsx` (TypeScript execution without compilation)
