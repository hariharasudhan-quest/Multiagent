import { randomUUID } from "crypto"
import type { Task, PhaseResult, TraceEvent, SessionRecord } from "./types"

class TaskStore {
  private tasks = new Map<string, Task>()
  private sessions = new Map<string, SessionRecord>()
  private traces: TraceEvent[] = []

  create(description: string): Task {
    const task: Task = {
      id: randomUUID().slice(0, 8),
      description,
      status: "pending",
      currentPhase: null,
      phases: {},
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

  setStatus(id: string, status: Task["status"]): void {
    const task = this.tasks.get(id)
    if (!task) return
    task.status = status
    task.updatedAt = new Date().toISOString()
  }

  recordPhase(id: string, phase: string, result: PhaseResult): void {
    const task = this.tasks.get(id)
    if (!task) return
    task.phases[phase] = result
    task.currentPhase = phase
    task.updatedAt = new Date().toISOString()
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
  }

  addToSessionHistory(id: string, role: "user" | "assistant", text: string): void {
    const s = this.sessions.get(id)
    if (s) {
      s.history.push({ role, text })
      s.updatedAt = new Date().toISOString()
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
