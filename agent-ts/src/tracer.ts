import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import type { Part } from "@opencode-ai/sdk"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SESSIONS_DIR = path.join(__dirname, "..", "data", "sessions")
const PROXY_LOG = path.join(__dirname, "..", "logs", "raw_traffic.jsonl")

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/** Read the JSONL proxy log file as an array of objects */
function readProxyLog(): any[] {
  try {
    const raw = fs.readFileSync(PROXY_LOG, "utf8")
    if (!raw.trim()) return []
    return raw
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try { return JSON.parse(line) } catch { return null }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

interface ToolCall {
  tool: string
  reasoning: string
  input: unknown
  executed: boolean // false = model wrote <tool_call> as text but SDK did not execute it
}

interface ProxyInsight {
  model_reasoning: string         // full thinking text from the model's reasoning delta
  tool_calls_attempted: Array<{   // tool_calls properly emitted in SSE delta (executed by OpenCode)
    tool: string
    arguments: unknown
  }>
  execution_gap: boolean          // model mentioned a tool in reasoning but no tool_call was emitted
  proxy_entry_id: string          // id of the matched proxy log entry
}

function parseSSE(body: string): { reasoning: string; content: string; toolCalls: Array<{ tool: string; arguments: unknown }> } {
  let reasoning = ""
  let content = ""
  const toolCalls: Array<{ tool: string; arguments: unknown }> = []
  const toolCallBuffers: Record<number, { name: string; args: string }> = {}

  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue
    const raw = line.slice(6).trim()
    if (raw === "[DONE]") continue
    try {
      const chunk = JSON.parse(raw)
      const delta = chunk?.choices?.[0]?.delta ?? {}
      if (delta.reasoning) reasoning += delta.reasoning
      if (delta.content) content += delta.content
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx: number = tc.index ?? 0
          if (!toolCallBuffers[idx]) {
            toolCallBuffers[idx] = { name: tc.function?.name ?? "", args: "" }
          }
          if (tc.function?.name) toolCallBuffers[idx].name = tc.function.name
          if (tc.function?.arguments) toolCallBuffers[idx].args += tc.function.arguments
        }
      }
    } catch {
      // malformed chunk — skip
    }
  }

  for (const buf of Object.values(toolCallBuffers)) {
    try {
      toolCalls.push({ tool: buf.name, arguments: JSON.parse(buf.args) })
    } catch {
      toolCalls.push({ tool: buf.name, arguments: buf.args })
    }
  }

  return { reasoning, content, toolCalls }
}

const TOOL_KEYWORDS = ["tool", "write", "edit", "bash", "read", "glob", "grep", "create", "file"]

export function loadProxyTokens(runTimestamp: string, latencyMs: number): { input: number; output: number } | null {
  try {
    const entries = readProxyLog()
    if (!entries.length) return null

    const runEnd = new Date(runTimestamp).getTime()
    const runStart = runEnd - latencyMs - 5000

    const matching = entries.filter((e) => {
      const ts = new Date(e?.ts ?? 0).getTime()
      return ts >= runStart && ts <= runEnd + 5000
    })

    if (!matching.length) return null

    let input = 0
    let output = 0
    for (const entry of matching) {
      const resp = entry?.response
      if (resp?.usage) {
        input += resp.usage.prompt_tokens ?? resp.usage.input_tokens ?? 0
        output += resp.usage.completion_tokens ?? resp.usage.output_tokens ?? 0
      }
      // Ollama native format
      if (resp?.prompt_eval_count !== undefined) input += resp.prompt_eval_count
      if (resp?.eval_count !== undefined) output += resp.eval_count
    }
    return { input, output }
  } catch {
    return null
  }
}

export function loadProxyInsight(runTimestamp: string, latencyMs: number): ProxyInsight | null {
  try {
    const entries = readProxyLog()
    if (!entries.length) return null

    const runEnd = new Date(runTimestamp).getTime()
    const runStart = runEnd - latencyMs - 5000

    // Find proxy entries whose ts falls within the run window
    const matching = entries.filter((e) => {
      const ts = new Date(e?.ts ?? 0).getTime()
      return ts >= runStart && ts <= runEnd + 5000
    })

    if (!matching.length) return null

    // Collect tool_calls from ALL entries in the window (the tool call is emitted
    // in an early LLM round; the last entry is the post-tool summary with no tool_calls).
    const allToolCalls: Array<{ tool: string; arguments: unknown }> = []
    let combinedReasoning = ""
    let firstEntryWithTools: any = null

    for (const entry of matching) {
      const body: string = entry?.response?.body ?? ""
      const { reasoning, toolCalls } = parseSSE(body)
      if (reasoning) combinedReasoning = reasoning  // keep last non-empty reasoning
      if (toolCalls.length > 0) {
        allToolCalls.push(...toolCalls)
        if (!firstEntryWithTools) firstEntryWithTools = entry
      }
    }

    // Fall back to last entry id if no tool entry found
    const lastEntry = matching[matching.length - 1]
    const representativeEntry = firstEntryWithTools ?? lastEntry

    const reasoningLower = combinedReasoning.toLowerCase()
    const mentionsTool = TOOL_KEYWORDS.some((k) => reasoningLower.includes(k))

    return {
      model_reasoning: combinedReasoning,
      tool_calls_attempted: allToolCalls,
      execution_gap: mentionsTool && allToolCalls.length === 0,
      proxy_entry_id: representativeEntry?.meta?.id ?? "unknown",
    }
  } catch {
    return null
  }
}

function parseTextToolCalls(text: string): Array<{ tool: string; input: Record<string, unknown> }> {
  const calls: Array<{ tool: string; input: Record<string, unknown> }> = []
  const regex = /<tool_call>\s*<function=([^>]+)>([\s\S]*?)<\/function>\s*<\/tool_call>/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const tool = match[1].trim()
    const inner = match[2]
    const input: Record<string, unknown> = {}
    const paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/g
    let pMatch: RegExpExecArray | null
    while ((pMatch = paramRegex.exec(inner)) !== null) {
      const key = pMatch[1]
      const value = pMatch[2].trim()
      try {
        input[key] = JSON.parse(value)
      } catch {
        input[key] = value
      }
    }
    calls.push({ tool, input })
  }
  return calls
}

function extractToolCalls(parts: Part[]): ToolCall[] {
  const calls: ToolCall[] = []
  let lastReasoning = ""
  let textParts: string[] = []

  for (const part of parts) {
    if (part.type === "reasoning") {
      lastReasoning = part.text ?? ""
    } else if (part.type === "tool") {
      const state = part.state as Record<string, unknown>
      const toolName = String(
        (state as any).toolName ??
        (state as any).name ??
        (state as any).tool ??
        "unknown"
      )
      const input = (state as any).input ?? null

      calls.push({
        tool: toolName,
        reasoning: lastReasoning,
        input,
        executed: true,
      })

      lastReasoning = ""
    } else if (part.type === "text") {
      textParts.push(part.text)
    }
  }

  // Fallback: model may write <tool_call> as text instead of SDK executing it
  const fullText = textParts.join("\n")
  const textCalls = parseTextToolCalls(fullText)
  for (const tc of textCalls) {
    calls.push({
      tool: tc.tool,
      reasoning: lastReasoning,
      input: tc.input,
      executed: false,
    })
  }

  return calls
}

export interface TraceEntry {
  timestamp: string
  session_id: string
  agent: string
  user_prompt: string
  response: string
  tokens: { input: number; output: number }
  latency_ms: number
  tools_used: ToolCall[]
  proxy_insight: ProxyInsight | null
}

export function appendTrace(entry: TraceEntry): void {
  ensureDir(SESSIONS_DIR)

  const filePath = path.join(SESSIONS_DIR, `${entry.session_id}.json`)

  let existing: TraceEntry[] = []

  try {
    const raw = fs.readFileSync(filePath, "utf8")
    if (raw.trim()) existing = JSON.parse(raw)
  } catch {
    existing = []
  }

  existing.push(entry)

  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), "utf8")
}

export function buildTrace(params: {
  agent: string
  sessionId: string
  userPrompt: string
  response: string
  parts: Part[]
  tokens: { input: number; output: number }
  latencyMs: number
}): TraceEntry {
  const insight = loadProxyInsight(new Date().toISOString(), params.latencyMs)

  // SDK parts may miss tool calls because OpenCode handles them internally.
  // Merge proxy SSE tool_calls so the trace always captures what the model emitted.
  const sdkTools = extractToolCalls(params.parts)
  const proxyTools: ToolCall[] = (insight?.tool_calls_attempted ?? []).map((t) => ({
    tool: t.tool,
    reasoning: insight?.model_reasoning ?? "",
    input: t.arguments,
    executed: true,
  }))

  // Deduplicate by tool name + input fingerprint
  const seen = new Set<string>()
  const merged: ToolCall[] = []
  for (const tc of [...proxyTools, ...sdkTools]) {
    const key = JSON.stringify({ tool: tc.tool, input: tc.input })
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(tc)
    }
  }

  return {
    timestamp: new Date().toISOString(),
    session_id: params.sessionId,
    agent: params.agent,
    user_prompt: params.userPrompt,
    response: params.response,
    tokens: params.tokens,
    latency_ms: params.latencyMs,
    tools_used: merged,
    proxy_insight: insight,
  }
}
