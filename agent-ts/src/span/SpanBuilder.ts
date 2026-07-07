import { SpanEvent, SpanStatus } from "../types"

/**
 * Responsible only for building span data structure
 * Single Responsibility: Data construction
 */
export class SpanBuilder {
  private attributes: Record<string, string | number | boolean | string[]> = {}
  private events: SpanEvent[] = []
  private status: { code: SpanStatus; message?: string } = { code: SpanStatus.UNSET }

  setAgent(agentName: string, agentUsed?: string): this {
    this.attributes["agent.name"] = agentName
    if (agentUsed) this.attributes["agent.used"] = agentUsed
    return this
  }

  setModel(modelId: string, providerId: string): this {
    this.attributes["model.id"] = modelId
    this.attributes["model.provider"] = providerId
    return this
  }

  setPhase(phaseName: string, phaseType?: string): this {
    this.attributes["phase.name"] = phaseName
    if (phaseType) this.attributes["phase.type"] = phaseType
    return this
  }

  recordTokenUsage(inputTokens: number, outputTokens: number): this {
    this.attributes["token.input"] = inputTokens
    this.attributes["token.output"] = outputTokens
    this.attributes["token.total"] = inputTokens + outputTokens
    return this
  }

  recordFilesModified(files: string[]): this {
    this.attributes["files.modified.count"] = files.length
    this.attributes["files.modified.list"] = files
    return this
  }

  recordOutputLength(length: number): this {
    this.attributes["output.length"] = length
    return this
  }

  recordTTFT(ms: number): this {
    this.attributes["llm.ttft.ms"] = ms
    return this
  }

  recordStreamingDuration(ms: number): this {
    this.attributes["llm.stream.duration.ms"] = ms
    return this
  }

  recordTokensPerSecond(tps: number): this {
    this.attributes["llm.tokens.per.second"] = tps
    return this
  }

  addEvent(name: string, attributes?: Record<string, unknown>): this {
    this.events.push({ name, timestamp: Date.now(), attributes })
    return this
  }

  setStatus(code: SpanStatus, message?: string): this {
    this.status = { code, message }
    return this
  }

  markSuccess(): this {
    this.status = { code: SpanStatus.OK }
    return this
  }

  markError(message: string): this {
    this.status = { code: SpanStatus.ERROR, message }
    return this
  }

  markCancelled(message?: string): this {
    this.status = { code: SpanStatus.CANCELLED, message }
    return this
  }

  getAttributes(): Record<string, string | number | boolean | string[]> {
    return { ...this.attributes }
  }

  getEvents(): SpanEvent[] {
    return [...this.events]
  }

  getStatus(): { code: SpanStatus; message?: string } {
    return { ...this.status }
  }
}
