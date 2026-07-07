export type TaskStatus = "pending" | "running" | "done" | "failed"

export interface Task {
  id: string
  description: string
  status: TaskStatus
  createdAt: string
  updatedAt: string
}

export interface HistoryTurn {
  role: "user" | "assistant"
  text: string
}

export interface SessionRecord {
  id: string
  title: string
  agent: string
  createdAt: string
  updatedAt: string
  history: HistoryTurn[]
}

export interface TraceEvent {
  id: string
  taskId?: string
  type: string
  timestamp: string
  data: Record<string, unknown>
}
