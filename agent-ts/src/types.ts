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

// ── Span Types ─────────────────────────────────────────────────────────────
export enum SpanStatus {
  UNSET = 0,
  OK = 1,
  ERROR = 2,
  CANCELLED = 3,
}

export interface SpanContext {
  traceId: string
  spanId: string
  parentSpanId?: string
}

export interface SpanData {
  spanId: string
  traceId: string
  parentSpanId?: string
  name: string
  startTime: number
  endTime: number
  durationMs: number
  attributes: Record<string, string | number | boolean | string[]>
  events: SpanEvent[]
  status: { code: SpanStatus; message?: string }
  taskId?: string
  sessionId?: string
}

export interface SpanEvent {
  name: string
  timestamp: number
  attributes?: Record<string, unknown>
}

export interface SpanExporter {
  export(span: SpanData): void
}
