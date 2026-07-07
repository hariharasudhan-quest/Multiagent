import { randomUUID } from "crypto"
import { trace, Span as OTelSpan, SpanKind, Context } from "@opentelemetry/api"
import { SpanStatusCode } from "@opentelemetry/api"
import { SpanBuilder } from "./span/SpanBuilder"
import { SpanStatus } from "./types"
import type { SpanContext, SpanData, SpanExporter, SpanEvent } from "./types"
import { appendFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"

export const consoleExporter: SpanExporter = {
  export(span: SpanData) {
    console.log("[Span]", JSON.stringify(span, null, 2))
  },
}

export class FileSpanExporter implements SpanExporter {
  private filePath: string

  constructor(filePath?: string) {
    const dir = join(homedir(), ".agent-ts", "spans")
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    this.filePath = filePath || join(dir, "spans.jsonl")
  }

  export(span: SpanData): void {
    appendFileSync(this.filePath, JSON.stringify(span) + "\n")
  }
}

export class OTelSpanExporter implements SpanExporter {
  export(spanData: SpanData): void {
    const tracer = trace.getTracer("agent-ts", "1.0.0")
    const span = tracer.startSpan(spanData.name, {
      kind: SpanKind.INTERNAL,
      attributes: {
        ...spanData.attributes,
        "span.id": spanData.spanId,
        "trace.id": spanData.traceId,
        "parent.span.id": spanData.parentSpanId,
        "task.id": spanData.taskId,
        "session.id": spanData.sessionId,
      },
    })

    spanData.events.forEach((event) => {
      span.addEvent(event.name, event.attributes, event.timestamp)
    })

    if (spanData.status.code === (SpanStatus.OK as number)) {
      span.setStatus({ code: SpanStatusCode.OK })
    } else if (spanData.status.code === (SpanStatus.ERROR as number)) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        description: spanData.status.message,
      })
    } else if (spanData.status.code === (SpanStatus.CANCELLED as number)) {
      span.setStatus({ code: SpanStatusCode.ERROR, description: "Cancelled" })
    }

    span.end(spanData.endTime)
  }
}

class SpanLifecycle {
  private startTime: number
  private endTime: number | null = null
  private ended = false

  constructor() {
    this.startTime = Date.now()
  }

  end(): number {
    if (this.ended) {
      return this.endTime ?? this.startTime
    }
    this.ended = true
    this.endTime = Date.now()
    return this.endTime
  }

  getDuration(): number {
    return (this.endTime ?? Date.now()) - this.startTime
  }

  getStartTime(): number {
    return this.startTime
  }

  getEndTime(): number {
    return this.endTime ?? Date.now()
  }

  isEnded(): boolean {
    return this.ended
  }
}

export class AgentSpan {
  private spanId: string
  private traceId: string
  private parentSpanId?: string
  private lifecycle: SpanLifecycle
  private builder: SpanBuilder

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
    this.lifecycle = new SpanLifecycle()
    this.builder = new SpanBuilder()
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
    this.builder.setAgent(agentName, agentUsed)
  }

  setModel(modelId: string, providerId: string): void {
    this.builder.setModel(modelId, providerId)
  }

  setPhase(phaseName: string, phaseType?: string): void {
    this.builder.setPhase(phaseName, phaseType)
  }

  recordTokenUsage(inputTokens: number, outputTokens: number): void {
    this.builder.recordTokenUsage(inputTokens, outputTokens)
  }

  recordFilesModified(files: string[]): void {
    this.builder.recordFilesModified(files)
  }

  recordOutputLength(length: number): void {
    this.builder.recordOutputLength(length)
  }

  recordTTFT(ms: number): void {
    this.builder.recordTTFT(ms)
  }

  recordStreamingDuration(ms: number): void {
    this.builder.recordStreamingDuration(ms)
  }

  recordTokensPerSecond(tps: number): void {
    this.builder.recordTokensPerSecond(tps)
  }

  addEvent(name: string, attributes?: Record<string, unknown>): void {
    if (this.lifecycle.isEnded()) return
    this.builder.addEvent(name, attributes)
  }

  setStatus(code: SpanStatus, message?: string): void {
    this.builder.setStatus(code, message)
  }

  markSuccess(): void {
    this.builder.markSuccess()
  }

  markError(message: string): void {
    this.builder.markError(message)
  }

  markCancelled(message?: string): void {
    this.builder.markCancelled(message)
  }

  end(): SpanData {
    if (this.lifecycle.isEnded()) {
      return this.toData()
    }
    this.lifecycle.end()
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
      startTime: this.lifecycle.getStartTime(),
      endTime: this.lifecycle.getEndTime(),
      durationMs: this.lifecycle.getDuration(),
      attributes: this.builder.getAttributes(),
      events: this.builder.getEvents(),
      status: this.builder.getStatus(),
      taskId: this.taskId,
      sessionId: this.sessionId,
    }
  }

  getData(): SpanData {
    return this.toData()
  }
}

export { SpanStatus } from "./types"
export type { SpanContext, SpanData, SpanExporter, SpanEvent } from "./types"
