import { initializeOtel } from "./otel"
import express, { Request, Response } from "express"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { store } from "./store"
import { runAgent, getClient } from "./runner"

// Initialize OpenTelemetry at the very top
initializeOtel()

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(express.json())
app.use(express.static(join(__dirname, "..", "public")))

// ── Run (agent + prompt in one shot, optional session reuse) ──────────────────

app.post("/run", async (req: Request, res: Response) => {
  const { agent, prompt, sessionId } = req.body as {
    agent?: string
    prompt?: string
    sessionId?: string
  }
  if (!agent?.trim()) return res.status(400).json({ error: "agent is required" })
  if (!prompt?.trim()) return res.status(400).json({ error: "prompt is required" })

  try {
    const result = await runAgent(agent, prompt, sessionId)
    if (sessionId && result.success) {
      store.updateSessionAgent(sessionId, result.agentUsed)
    }
    return res.json(result)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ error: msg })
  }
})

// ── Sessions ──────────────────────────────────────────────────────────────────

app.get("/sessions", (_req: Request, res: Response) => {
  return res.json({ sessions: store.listSessions() })
})

app.get("/sessions/:id", (req: Request, res: Response) => {
  const session = store.getSession(req.params.id)
  if (!session) return res.status(404).json({ error: "session not found" })
  return res.json(session)
})

// ── Legacy Tasks (still works) ──────────────────────────────────────────────

app.post("/tasks", (req: Request, res: Response) => {
  const { description } = req.body as { description?: string }
  if (!description?.trim()) return res.status(400).json({ error: "description is required" })
  return res.status(201).json(store.create(description.trim()))
})

app.get("/tasks", (_req: Request, res: Response) => {
  return res.json({ tasks: store.list(), summary: store.summary() })
})

app.get("/tasks/:id", (req: Request, res: Response) => {
  const task = store.get(req.params.id)
  if (!task) return res.status(404).json({ error: "task not found" })
  return res.json(task)
})

// ── Agents from OpenCode ──────────────────────────────────────────────────────

app.get("/agents", async (_req: Request, res: Response) => {
  try {
    const client = await getClient()
    const resp = await client.app.agents()
    return res.json(resp.data ?? [])
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ error: msg })
  }
})

app.get("/subagents", async (_req: Request, res: Response) => {
  try {
    const client = await getClient()
    const resp = await client.app.agents()
    const subagents = (resp.data ?? []).filter(
      (a) => a.mode === "subagent" || a.mode === "all",
    )
    return res.json(subagents)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ error: msg })
  }
})

// ── Traces ────────────────────────────────────────────────────────────────────

app.get("/traces", (req: Request, res: Response) => {
  const { taskId } = req.query as { taskId?: string }
  const traces = store.getTraces(taskId)
  return res.json({ traces, count: traces.length })
})

// ── Health ────────────────────────────────────────────────────────────────────

app.get("/", (_req: Request, res: Response) => {
  return res.json({
    service: "agent-ts",
    runtime: "OpenCode SDK + Ollama",
    endpoints: {
      "POST /run": "run agent with prompt (optional sessionId to reuse)",
      "GET /sessions": "list active sessions",
      "GET /sessions/:id": "get session info",
      "POST /tasks": "(legacy) create a task",
      "GET /tasks": "(legacy) list tasks",
      "GET /agents": "list all OpenCode agents",
      "GET /subagents": "list subagents only",
      "GET /traces": "OpenCode event stream",
    },
    sessions: store.listSessions().length,
    summary: store.summary(),
  })
})

const PORT = Number(process.env.PORT ?? 3000)
app.listen(PORT, () => {
  console.log(`agent-ts listening on http://localhost:${PORT}`)
})
