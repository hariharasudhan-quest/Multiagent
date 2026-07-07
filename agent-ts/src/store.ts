import { randomUUID } from "crypto"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import type { Task, TraceEvent, SessionRecord } from "./types"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SESSIONS_FILE = path.join(__dirname, "..", "data", "sessions.json")

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function loadSessions(): Map<string, SessionRecord> {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return new Map()
    const raw = fs.readFileSync(SESSIONS_FILE, "utf8")
    const parsed = JSON.parse(raw) as SessionRecord[]
    return new Map(parsed.map((s) => [s.id, s]))
  } catch {
    return new Map()
  }
}

function saveSessions(sessions: Map<string, SessionRecord>): void {
  ensureDir(SESSIONS_FILE)
  const data = Array.from(sessions.values())
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2), "utf8")
}

class TaskStore {
  private tasks = new Map<string, Task>()
  private sessions = loadSessions()
  private traces: TraceEvent[] = []

  create(description: string): Task {
    const task: Task = {
      id: randomUUID().slice(0, 8),
      description,
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this.tasks.set(task.id, task)
    return task
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  list(): Task[] {
    return Array.from(this.tasks.values())
  }

  addTrace(event: TraceEvent): void {
    this.traces.push(event)
    if (this.traces.length > 2000) this.traces.shift()
  }

  getTraces(taskId?: string): TraceEvent[] {
    if (taskId) return this.traces.filter((t) => t.taskId === taskId)
    return this.traces
  }

  // ── Sessions ────────────────────────────────────────────────────────────────

  addSession(session: Omit<SessionRecord, "history">): void {
    const full: SessionRecord = { ...session, history: [] }
    this.sessions.set(full.id, full)
    saveSessions(this.sessions)
  }

  addToSessionHistory(id: string, role: "user" | "assistant", text: string): void {
    const s = this.sessions.get(id)
    if (s) {
      s.history.push({ role, text })
      // Cap to prevent unbounded growth
      if (s.history.length > 20) {
        s.history = s.history.slice(-20)
      }
      s.updatedAt = new Date().toISOString()
      saveSessions(this.sessions)
    }
  }

  getSession(id: string): SessionRecord | undefined {
    return this.sessions.get(id)
  }

  listSessions(): SessionRecord[] {
    return Array.from(this.sessions.values())
  }

  updateSessionAgent(id: string, agent: string): void {
    const s = this.sessions.get(id)
    if (s) {
      s.agent = agent
      s.updatedAt = new Date().toISOString()
      saveSessions(this.sessions)
    }
  }

  summary() {
    const tasks = this.list()
    return {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === "pending").length,
      running: tasks.filter((t) => t.status === "running").length,
      done: tasks.filter((t) => t.status === "done").length,
      failed: tasks.filter((t) => t.status === "failed").length,
    }
  }
}

export const store = new TaskStore()
