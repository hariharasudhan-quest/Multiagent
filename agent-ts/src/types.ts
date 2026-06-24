export type TaskStatus = "pending" | "running" | "done" | "failed"

export interface PhaseResult {
  agent: string
  agentUsed: string
  sessionId: string
  output: string
  filesModified: string[]
  tokens: { input: number; output: number }
  latencyMs: number
  success: boolean
  error?: string
  timestamp: string
}

export interface Task {
  id: string
  description: string
  status: TaskStatus
  currentPhase: string | null
  phases: Record<string, PhaseResult>
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
