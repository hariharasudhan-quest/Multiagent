import { runAgent } from "./runner"
import type { RunResult } from "./runner"
import { store } from "./store"
import type { PhaseResult } from "./types"

function toPhaseResult(agent: string, r: RunResult): PhaseResult {
  return {
    agent,
    agentUsed: r.agentUsed,
    sessionId: r.sessionId,
    output: r.text,
    filesModified: r.filesModified,
    tokens: r.tokens,
    latencyMs: r.latencyMs,
    success: r.success,
    error: r.error,
    timestamp: new Date().toISOString(),
  }
}

export async function runSingleAgent(
  taskId: string,
  agentName: string,
  extraContext?: string,
): Promise<RunResult> {
  const task = store.get(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)

  const prompt = extraContext
    ? `${task.description}\n\n${extraContext}`
    : task.description

  store.setStatus(taskId, "running")
  const result = await runAgent(agentName, prompt)
  store.recordPhase(taskId, agentName, toPhaseResult(agentName, result))
  store.setStatus(taskId, result.success ? "done" : "failed")

  return result
}
