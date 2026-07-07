import { createOpencodeClient } from "@opencode-ai/sdk"
import type { Part } from "@opencode-ai/sdk"
import { randomUUID } from "crypto"
import { store } from "./store"
import { AgentSpan, CompositeExporter, FileSpanExporter, OTelSpanExporter } from "./span"
import type { SpanContext } from "./types"
import { setTraceContext } from "./traceContext"

const MODEL = {
  providerID: "ollama",
  modelID: process.env.OPENCODE_MODEL_ID ?? "qwen3:8b",
}

type OpenCodeClient = ReturnType<typeof createOpencodeClient>

let _client: OpenCodeClient | null = null

export async function getClient(): Promise<OpenCodeClient> {
  if (_client) return _client

  const OPENCODE_URL = process.env.OPENCODE_URL ?? "http://127.0.0.1:4096"
  _client = createOpencodeClient({ baseUrl: OPENCODE_URL })

  startEventStream(_client)

  return _client
}

function startEventStream(client: OpenCodeClient): void {
  ;(async () => {
    try {
      const sub = await client.event.subscribe()
      for await (const event of sub.stream) {
        const e = event as Record<string, unknown>
        store.addTrace({
          id: randomUUID().slice(0, 8),
          type: String(e.type ?? "unknown"),
          timestamp: new Date().toISOString(),
          data: e,
        })
      }
    } catch {
      // stream ended or server stopped — no-op
    }
  })()
}

export interface RunResult {
  sessionId: string
  agentUsed: string
  text: string
  filesModified: string[]
  tokens: { input: number; output: number }
  latencyMs: number
  success: boolean
  error?: string
}

export async function runAgent(
  agentName: string,
  prompt: string,
  existingSessionId?: string,
  parentContext?: { traceId: string; spanId: string },
): Promise<RunResult> {
  const client = await getClient()
  const start = Date.now()
  let sessionId: string

  // Create span for this agent execution — exports to both local JSON and OTel
  const exporter = new CompositeExporter([new FileSpanExporter(), new OTelSpanExporter()])
  const span = parentContext
    ? AgentSpan.child(parentContext, `agent.${agentName}`, undefined, existingSessionId, exporter)
    : AgentSpan.root(`agent.${agentName}`, undefined, existingSessionId, exporter)

  span.setAgent(agentName)
  span.setModel(MODEL.modelID, MODEL.providerID)
  span.addEvent("agent.started")

  try {
    if (existingSessionId) {
      sessionId = existingSessionId
      console.log(`[${agentName}] reusing session ${sessionId}`)
      span.addEvent("session.reused", { sessionId })
    } else {
      console.log(`[${agentName}] creating session...`)
      const sessionResp = await client.session.create({
        body: { title: `${agentName}-${Date.now()}` },
      })
      const session = sessionResp.data
      if (!session) throw new Error("Failed to create OpenCode session")
      sessionId = session.id
      console.log(`[${agentName}] session created:`, sessionId)
      store.addSession({
        id: sessionId,
        title: session.title,
        agent: agentName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      span.addEvent("session.created", { sessionId })
    }

    // Store trace context for proxy to use
    const ctx = span.getContext()
    setTraceContext(sessionId, ctx)

    // Add current user prompt to session history
    store.addToSessionHistory(sessionId, "user", prompt)

    // Build full conversation context from history
    const history = store.getSession(sessionId)?.history ?? []
    const historyText = history
      .map((h) => (h.role === "user" ? `User: ${h.text}` : `Assistant: ${h.text}`))
      .join("\n\n")

    const promptWithContext = historyText
      ? `Previous conversation:\n\n${historyText}\n\nContinue the conversation.`
      : prompt

    console.log(`[${agentName}] sending prompt (history=${history.length} turns)...`)
    span.addEvent("llm.request.sent", { historyTurns: history.length })

    const result = await client.session.prompt({
      path: { id: sessionId },
      body: {
        agent: agentName,
        model: MODEL,
        parts: [{ type: "text", text: promptWithContext }],
      },
      // Note: OpenCode SDK may not support custom headers here
      // The proxy will create its own spans based on the trace context
      // We'll need to ensure the proxy can access the trace context
    })

    console.log(`[${agentName}] prompt completed in ${Date.now() - start}ms`)
    console.log("[debug] result keys:", Object.keys(result))
    console.log("[debug] result.data:", JSON.stringify(result.data, null, 2))
    const parts: Part[] = result.data?.parts ?? []
    const info = result.data?.info
    const responseText = extractText(parts)

    span.addEvent("llm.response.received")

    // Store assistant response in session history
    store.addToSessionHistory(sessionId, "assistant", responseText)

    // Record metrics
    const inputTokens = info?.tokens?.input ?? 0
    const outputTokens = info?.tokens?.output ?? 0
    const filesModified = extractFiles(parts)

    span.recordTokenUsage(inputTokens, outputTokens)
    span.recordFilesModified(filesModified)
    span.recordOutputLength(responseText.length)
    span.markSuccess()
    span.end()

    return {
      sessionId,
      agentUsed: agentName,
      text: responseText,
      filesModified,
      tokens: {
        input: inputTokens,
        output: outputTokens,
      },
      latencyMs: Date.now() - start,
      success: true,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    span.markError(msg)
    span.end()
    return {
      sessionId: existingSessionId ?? "",
      agentUsed: agentName,
      text: "",
      filesModified: [],
      tokens: { input: 0, output: 0 },
      latencyMs: Date.now() - start,
      success: false,
      error: msg,
    }
  }
}

function extractText(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim()
}

function extractFiles(parts: Part[]): string[] {
  const files = new Set<string>()

  for (const p of parts) {
    if (p.type === "patch") {
      p.files.forEach((f) => files.add(f))
    }
    if (p.type === "tool") {
      const state = p.state
      if (state.status === "completed" || state.status === "running") {
        const input = state.input as Record<string, unknown>
        const path = String(
          input.filePath ?? input.file_path ?? input.path ?? "",
        ).trim()
        if (path) files.add(path)
      }
    }
  }

  return Array.from(files)
}
