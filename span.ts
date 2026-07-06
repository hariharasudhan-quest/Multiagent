import { randomUUID } from "crypto"

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

export const consoleExporter: SpanExporter = {
  export(span: SpanData) {
    console.log("[Span]", JSON.stringify(span, null, 2))
  },
}

export class AgentSpan {
  private spanId: string
  private traceId: string
  private parentSpanId?: string

  private startTime: number
  private endTime: number | null = null
  private ended = false

  private attributes: Record<string, string | number | boolean | string[]> = {}
  private events: SpanEvent[] = []
  private status: { code: SpanStatus; message?: string } = { code: SpanStatus.UNSET }

  constructor(
    private spanName: string,
    ctx: SpanContext,
    private taskId?: string,
    private sessionId?: string,
    private exporter: SpanExporter = consoleExporter,
  ) {
    this.spanId = ctx.spanId
    this.traceId = ctx.traceId
    this.parentSpanId = ctx.parentSpanId
    this.startTime = Date.now()
  }

  static child(parent: SpanContext, name: string, taskId?: string, sessionId?: string, exporter?: SpanExporter): AgentSpan {
    return new AgentSpan(
      name,
      { traceId: parent.traceId, spanId: randomUUID().slice(0, 16), parentSpanId: parent.spanId },
      taskId,
      sessionId,
      exporter,
    )
  }

  static root(name: string, taskId?: string, sessionId?: string, exporter?: SpanExporter): AgentSpan {
    return new AgentSpan(
      name,
      { traceId: randomUUID().slice(0, 32), spanId: randomUUID().slice(0, 16) },
      taskId,
      sessionId,
      exporter,
    )
  }

  getContext(): SpanContext {
    return { traceId: this.traceId, spanId: this.spanId, parentSpanId: this.parentSpanId }
  }

  setAgent(agentName: string, agentUsed?: string): void {
    this.attributes["agent.name"] = agentName
    if (agentUsed) this.attributes["agent.used"] = agentUsed
  }

  setModel(modelId: string, providerId: string): void {
    this.attributes["model.id"] = modelId
    this.attributes["model.provider"] = providerId
  }

  setPhase(phaseName: string, phaseType?: string): void {
    this.attributes["phase.name"] = phaseName
    if (phaseType) this.attributes["phase.type"] = phaseType
  }

  recordTokenUsage(inputTokens: number, outputTokens: number): void {
    this.attributes["token.input"] = inputTokens
    this.attributes["token.output"] = outputTokens
    this.attributes["token.total"] = inputTokens + outputTokens
  }

  recordFilesModified(files: string[]): void {
    this.attributes["files.modified.count"] = files.length
    this.attributes["files.modified.list"] = files // string[], not comma-joined
  }

  recordOutputLength(length: number): void {
    this.attributes["output.length"] = length
  }

  recordTTFT(ms: number): void {
    this.attributes["llm.ttft.ms"] = ms
  }

  recordStreamingDuration(ms: number): void {
    this.attributes["llm.stream.duration.ms"] = ms
  }

  recordTokensPerSecond(tps: number): void {
    this.attributes["llm.tokens.per.second"] = tps
  }

  addEvent(name: string, attributes?: Record<string, unknown>): void {
    if (this.ended) return
    this.events.push({ name, timestamp: Date.now(), attributes })
  }

  setStatus(code: SpanStatus, message?: string): void {
    this.status = { code, message }
  }

  markSuccess(): void {
    this.status = { code: SpanStatus.OK }
  }

  markError(message: string): void {
    this.status = { code: SpanStatus.ERROR, message }
  }

  markCancelled(message?: string): void {
    this.status = { code: SpanStatus.CANCELLED, message }
  }

  end(): SpanData {
    if (this.ended) {
      return this.toData()
    }
    this.ended = true
    this.endTime = Date.now()
    const data = this.toData()
    this.exporter.export(data)
    return data
  }

  private toData(): SpanData {
    return {
      spanId: this.spanId,
      traceId: this.traceId,
      parentSpanId: this.parentSpanId,
      name: this.spanName,
      startTime: this.startTime,
      endTime: this.endTime ?? Date.now(),
      durationMs: (this.endTime ?? Date.now()) - this.startTime,
      attributes: this.attributes,
      events: this.events,
      status: this.status,
      taskId: this.taskId,
      sessionId: this.sessionId,
    }
  }

  getData(): SpanData {
    return this.toData()
  }
}
