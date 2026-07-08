import { createOpencodeClient } from "@opencode-ai/sdk"
import type { Part } from "@opencode-ai/sdk"
import { randomUUID } from "crypto"
import { store } from "./store"
import { buildTrace, appendTrace, loadProxyInsight, loadProxyTokens } from "./tracer"
import { AgentSpan, CompositeExporter, FileSpanExporter, OTelSpanExporter } from "./span"
import type { SpanContext } from "./types"
import { setTraceContext } from "./traceContext"

const MODEL = {
  providerID: "ollama",
  modelID: process.env.OPENCODE_MODEL_ID ?? "qwen3.5:9b-32k",
}

type OpenCodeClient = ReturnType<typeof createOpencodeClient>

let _client: OpenCodeClient | null = null

export async function getClient(): Promise<OpenCodeClient> {
  if (_client) return _client

  const OPENCODE_URL = process.env.OPENCODE_URL ?? "http://127.0.0.1:4096"
  _client = createOpencodeClient({ baseUrl: OPENCODE_URL })

  return _client
}

// Resolves when the session goes idle (no new events for `quietMs` ms)
// or after `timeoutMs` ms absolute. Returns collected events.
async function waitForSessionIdle(
  client: OpenCodeClient,
  sessionId: string,
  promptPromise: Promise<any>,
  quietMs = 5000,
  timeoutMs = 30 * 60 * 1000,
): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = []
  const sub = await client.event.subscribe()

  return new Promise((resolve) => {
    let quietTimer: ReturnType<typeof setTimeout> | null = null
    let hasPromptReturned = false

    const finish = () => {
      if (quietTimer) clearTimeout(quietTimer)
      if (typeof (sub as any).unsubscribe === "function") {
        ; (sub as any).unsubscribe().catch(() => { })
      }
      resolve(events)
    }

    const resetQuietTimer = () => {
      if (quietTimer) clearTimeout(quietTimer)
      // Only start the idle countdown if the LLM has actually finished generating its response!
      if (hasPromptReturned) {
        quietTimer = setTimeout(finish, quietMs)
      }
    }

    // Absolute timeout
    const absTimer = setTimeout(finish, timeoutMs)

    // Wait for the prompt to return, then start the idle timer
    promptPromise.then(() => {
      hasPromptReturned = true
      resetQuietTimer()
    }).catch(() => {
      hasPromptReturned = true
      resetQuietTimer()
    })

      ; (async () => {
        try {
          for await (const event of sub.stream) {
            const e = event as Record<string, unknown>

            // Only track events for our session
            const evtSession =
              (e.sessionID as string) ??
              ((e.data as any)?.sessionID as string) ??
              ""
            if (evtSession && evtSession !== sessionId) continue

            events.push(e)
            store.addTrace({
              id: randomUUID().slice(0, 8),
              type: String(e.type ?? "unknown"),
              timestamp: new Date().toISOString(),
              data: e,
            })

            // Mark done when we see explicit finish events
            const t = String(e.type ?? "")
            if (t === "session.idle" || t === "agent.done" || t === "run.complete") {
              clearTimeout(absTimer)
              finish()
              return
            }

            resetQuietTimer()
          }
        } catch {
          // stream ended
        }
        clearTimeout(absTimer)
        finish()
      })()
  })
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

    // Add current user prompt to session history (for our own records only)
    store.addToSessionHistory(sessionId, "user", prompt)

    console.log(`[${agentName}] sending prompt (session=${sessionId})...`)

    span.addEvent("llm.request.sent", { historyTurns: store.getSession(sessionId)?.history.length ?? 0 })

    const promptPromise = client.session.prompt({
      path: { id: sessionId },
      body: {
        agent: agentName,
        model: MODEL,
        parts: [{ type: "text", text: prompt }],
      },
    })

    // Start listening for events BEFORE we wait for the prompt to return
    const idlePromise = waitForSessionIdle(client, sessionId, promptPromise)

    const result = await promptPromise

    // Wait until the session goes quiet (all tool calls executed)
    console.log(`[${agentName}] prompt returned, waiting for session to go idle...`)
    await idlePromise
    console.log(`[${agentName}] session idle after ${Date.now() - start}ms`)

    const parts: Part[] = result.data?.parts ?? []
    const info = result.data?.info

    // SDK often returns 0 tokens for local models; fallback to proxy log
    const sdkTokens = { input: info?.tokens?.input ?? 0, output: info?.tokens?.output ?? 0 }
    const proxyTokens = loadProxyTokens(new Date().toISOString(), Date.now() - start)
    const tokens = sdkTokens.input > 0 || sdkTokens.output > 0
      ? sdkTokens
      : (proxyTokens ?? sdkTokens)

    let responseText = extractText(parts)

    // Always check proxy for tool calls — model often creates files
    // but returns useless text like "I made an error..."
    const insight = loadProxyInsight(new Date().toISOString(), Date.now() - start)
    const proxyTools = insight?.tool_calls_attempted ?? []
    if (proxyTools.length > 0) {
      const files = Array.from(
        new Set(
          proxyTools
            .map((tc) => {
              const args = tc.arguments as Record<string, unknown> | undefined
              return String(args?.filePath ?? args?.path ?? args?.file_path ?? "")
            })
            .filter(Boolean),
        ),
      )
      const fileSummary = files.length > 0
        ? `\n\n📁 Created ${files.length} file(s):\n${files.map((f) => `  • ${f}`).join("\n")}`
        : `\n\n🔧 Used tools: ${[...new Set(proxyTools.map((t) => t.tool))].join(", ")}`

      if (!responseText.trim()) {
        responseText = fileSummary.trim()
      } else {
        responseText += fileSummary
      }
    }

    span.addEvent("llm.response.received")

    // Store assistant response in session history
    store.addToSessionHistory(sessionId, "assistant", responseText)

    // Append run trace (harness + prompt + response + tool decisions)
    appendTrace(buildTrace({
      agent: agentName,
      sessionId,
      userPrompt: prompt,
      response: responseText,
      parts,
      tokens,
      latencyMs: Date.now() - start,
    }))

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
      filesModified: extractFiles(parts),
      tokens,
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
  const textParts = parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)

  if (textParts.length) {
    return textParts.join("\n").trim()
  }

  // Fallback: some responses have reasoning but no text part
  const reasoningParts = parts
    .filter((p): p is Extract<Part, { type: "reasoning" }> => p.type === "reasoning")
    .map((p) => p.text)

  return reasoningParts.join("\n").trim()
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
