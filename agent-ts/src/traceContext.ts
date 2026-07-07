import type { SpanContext } from "./types"

const traceContextStore = new Map<string, SpanContext>()

export function setTraceContext(sessionId: string, ctx: SpanContext): void {
  traceContextStore.set(sessionId, ctx)
}

export function getTraceContext(sessionId: string): SpanContext | undefined {
  return traceContextStore.get(sessionId)
}

export function clearTraceContext(sessionId: string): void {
  traceContextStore.delete(sessionId)
}
