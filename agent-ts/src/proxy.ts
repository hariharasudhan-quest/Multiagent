import express, { Request, Response } from "express"
import axios, { AxiosInstance } from "axios"
import dotenv from "dotenv"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { randomUUID } from "crypto"
import { AgentSpan, OTelSpanExporter } from "./span"

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const TARGET = process.env.PROXY_TARGET || "http://localhost:11434"
const LOG_DIR = path.join(__dirname, "..", "logs")
const LOG_FILE = path.join(LOG_DIR, "raw_traffic.jsonl")

fs.mkdirSync(LOG_DIR, { recursive: true })

const client: AxiosInstance = axios.create({
  timeout: 120_000,
  validateStatus: () => true,
})

const app = express()
app.use(express.raw({ type: "*/*", limit: "100mb" }))

app.all("*", async (req: Request, res: Response) => {
  const body = req.body as Buffer
  const headers = { ...req.headers }
  delete headers.host
  delete headers["content-length"]

  const t0 = Date.now()

  // Extract trace context from headers (if OpenCode SDK forwards them)
  const traceId = (headers["x-trace-id"] as string) || randomUUID().slice(0, 32)
  const parentSpanId = headers["x-span-id"] as string
  const taskId = headers["x-task-id"] as string
  const sessionId = headers["x-session-id"] as string

  // Create span for this HTTP request
  const span = parentSpanId
    ? AgentSpan.child({ traceId, spanId: parentSpanId }, "llm.http", taskId, sessionId, new OTelSpanExporter())
    : AgentSpan.root("llm.http", taskId, sessionId, new OTelSpanExporter())

  span.addEvent("http.request.started", {
    method: req.method,
    path: req.originalUrl,
  })

  try {
    const targetUrl = `${TARGET.replace(/\/$/, "")}${req.path}`

    // Parse request body to check for streaming
    let reqJson: unknown = null
    try {
      reqJson = body?.length ? JSON.parse(body.toString("utf8")) : null
    } catch {
      reqJson = body?.length ? body.toString("utf8") : null
    }

    const isStreaming = reqJson && typeof reqJson === "object" && (reqJson as any).stream === true

    if (isStreaming) {
      // Streaming passthrough with TTFT measurement
      span.addEvent("streaming.enabled")

      const response = await client.request({
        method: req.method,
        url: targetUrl,
        headers,
        data: body,
        responseType: "stream",
      })

      const stream = response.data
      let firstChunkTime: number | null = null
      let chunkCount = 0
      let totalBytes = 0

      stream.on("data", (chunk: Buffer) => {
        if (!firstChunkTime) {
          firstChunkTime = Date.now()
          const ttfbMs = firstChunkTime - t0
          span.recordTTFT(ttfbMs)
          span.addEvent("first.token.received", { ttfbMs })
        }
        chunkCount++
        totalBytes += chunk.length
        res.write(chunk)
      })

      stream.on("end", () => {
        const duration = Date.now() - t0
        span.recordStreamingDuration(duration)
        if (chunkCount > 0) {
          const tps = chunkCount / (duration / 1000)
          span.recordTokensPerSecond(tps)
          span.addEvent("streaming.completed", {
            duration,
            chunkCount,
            totalBytes,
            tps,
          })
        }
        span.markSuccess()
        span.end()
        res.end()
      })

      stream.on("error", (err: Error) => {
        span.markError(err.message)
        span.end()
        res.status(500).json({ error: err.message })
      })
    } else {
      // Non-streaming path
      const response = await client.request({
        method: req.method,
        url: targetUrl,
        headers,
        data: body,
        responseType: "arraybuffer",
      })

      let respJson: unknown = null

      try {
        respJson = JSON.parse(Buffer.from(response.data as ArrayBuffer).toString("utf8"))
      } catch {
        respJson = Buffer.from(response.data as ArrayBuffer).toString("utf8")
      }

      // Parse token usage from response
      let inputTokens = 0
      let outputTokens = 0
      if (respJson && typeof respJson === "object") {
        const resp = respJson as any
        // OpenAI-compatible format
        if (resp.usage) {
          inputTokens = resp.usage.prompt_tokens || resp.usage.input_tokens || 0
          outputTokens = resp.usage.completion_tokens || resp.usage.output_tokens || 0
        }
        // Ollama format
        if (resp.prompt_eval_count !== undefined) {
          inputTokens = resp.prompt_eval_count
        }
        if (resp.eval_count !== undefined) {
          outputTokens = resp.eval_count
        }
      }

      const logEntry = {
        ts: new Date().toISOString(),
        id: randomUUID().slice(0, 8),
        method: req.method,
        path: req.originalUrl,
        targetUrl,
        request: reqJson,
        response: respJson,
        status: response.status,
        ms: Date.now() - t0,
      }

      fs.appendFileSync(LOG_FILE, JSON.stringify(logEntry) + "\n", "utf8")

      // Record metrics
      span.recordTokenUsage(inputTokens, outputTokens)
      span.addEvent("http.response.received", {
        status: response.status,
        inputTokens,
        outputTokens,
      })

      if (response.status >= 400) {
        span.markError(`HTTP ${response.status}`)
      } else {
        span.markSuccess()
      }
      span.end()

      const responseHeaders = { ...response.headers }
      delete responseHeaders["transfer-encoding"]
      delete responseHeaders["content-encoding"]
      delete responseHeaders["content-length"]

      Object.entries(responseHeaders).forEach(([k, v]) => {
        if (v !== undefined) {
          res.setHeader(k, v as string)
        }
      })

      res.status(response.status).send(response.data)
    }
  } catch (err: any) {
    const logEntry = {
      ts: new Date().toISOString(),
      id: randomUUID().slice(0, 8),
      method: req.method,
      path: req.originalUrl,
      targetUrl: `${TARGET.replace(/\/$/, "")}${req.path}`,
      error: err.message,
      ms: Date.now() - t0,
    }
    fs.appendFileSync(LOG_FILE, JSON.stringify(logEntry) + "\n", "utf8")

    span.markError(err.message)
    span.end()

    res.status(500).json({ error: err.message })
  }
})

const PORT = process.env.PROXY_PORT || 8080
app.listen(PORT, () => {
  console.log(`HTTP proxy listening on http://localhost:${PORT}`)
  console.log(`Forwarding to: ${TARGET}`)
  console.log(`Logging to:    ${LOG_FILE}`)
})
