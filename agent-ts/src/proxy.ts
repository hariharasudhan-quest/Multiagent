import express, { Request, Response } from "express"
import axios, { AxiosInstance } from "axios"
import dotenv from "dotenv"
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { randomUUID } from "crypto"

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const TARGET =
  process.env.PROXY_TARGET || "http://localhost:11434"

const LOG = path.join(__dirname, "..", "logs", "raw_traffic.json")

await fs.mkdir(path.dirname(LOG), { recursive: true })

const PRICING: Record<
  string,
  {
    prompt: number
    completion: number
  }
> = {
  "gemini-2.5-flash": {
    prompt: 0.075,
    completion: 0.3,
  },
}

const app = express()
app.use(express.raw({ type: "*/*", limit: "50mb" }))

const client: AxiosInstance = axios.create({
  timeout: 300_000,
})

interface TokenCounts {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

function extractTokenCounts(responseData: any): TokenCounts {
  const tokens: TokenCounts = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  }

  if (
    typeof responseData === "object" &&
    responseData !== null &&
    "usage" in responseData
  ) {
    const usage = responseData.usage

    tokens.prompt_tokens = usage?.prompt_tokens ?? 0
    tokens.completion_tokens = usage?.completion_tokens ?? 0
    tokens.total_tokens = usage?.total_tokens ?? 0
  } else if (
    typeof responseData === "string" &&
    responseData.includes("data:")
  ) {
    const lines = responseData.split("\n").reverse()

    for (const lineRaw of lines) {
      const line = lineRaw.trim()

      if (line.startsWith("data:") && !line.includes("[DONE]")) {
        try {
          const chunk = JSON.parse(line.slice(5).trim())

          if (chunk.usage) {
            tokens.prompt_tokens = chunk.usage.prompt_tokens ?? 0
            tokens.completion_tokens =
              chunk.usage.completion_tokens ?? 0
            tokens.total_tokens = chunk.usage.total_tokens ?? 0
            break
          }
        } catch {}
      }
    }
  }

  return tokens
}

function classifyError(statusCode: number) {
  const errorInfo = {
    error_type: "success",
    error_category: null as string | null,
    is_client_error: false,
    is_server_error: false,
    is_rate_limit: false,
  }

  if (statusCode >= 400 && statusCode < 500) {
    errorInfo.error_type = "client_error"
    errorInfo.error_category = "4xx"
    errorInfo.is_client_error = true

    if (statusCode === 429) {
      errorInfo.is_rate_limit = true
    }
  } else if (statusCode >= 500 && statusCode < 600) {
    errorInfo.error_type = "server_error"
    errorInfo.error_category = "5xx"
    errorInfo.is_server_error = true
  }

  return errorInfo
}

function calculateCost(tokens: TokenCounts, model: string) {
  const costInfo = {
    prompt_cost: 0,
    completion_cost: 0,
    total_cost: 0,
  }

  let modelPricing:
    | {
        prompt: number
        completion: number
      }
    | undefined

  for (const pricingModel of Object.keys(PRICING)) {
    if (model.toLowerCase().includes(pricingModel)) {
      modelPricing = PRICING[pricingModel]
      break
    }
  }

  if (!modelPricing) {
    return costInfo
  }

  const promptCost =
    (tokens.prompt_tokens / 1_000_000) * modelPricing.prompt

  const completionCost =
    (tokens.completion_tokens / 1_000_000) *
    modelPricing.completion

  return {
    prompt_cost: Number(promptCost.toFixed(6)),
    completion_cost: Number(completionCost.toFixed(6)),
    total_cost: Number((promptCost + completionCost).toFixed(6)),
  }
}

async function appendLog(logEntry: any) {
  let existing: any[] = []

  try {
    const content = await fs.readFile(LOG, "utf-8")

    if (content.trim()) {
      existing = JSON.parse(content)
    }
  } catch {}

  existing.push(logEntry)

  let output = JSON.stringify(existing, null, 2)

  output = output
    .replace(/",\n\s+"/g, '",\n\n    "')
    .replace(/    },\n    {/g, "    },\n\n    {")

  await fs.writeFile(LOG, output, "utf-8")
}

app.all("*", async (req: Request, res: Response) => {
  try {
    const pathPart = req.params[0] ?? ""

    let body = req.body as Buffer

    // Inject Ollama context window so local models don't truncate to 2048 tokens
    const NUM_CTX = Number(process.env.OLLAMA_NUM_CTX ?? 32768)
    if (body?.length) {
      try {
        const parsed = JSON.parse(body.toString("utf8"))
        if (typeof parsed === "object" && parsed !== null) {
          parsed.options = { ...(parsed.options ?? {}), num_ctx: NUM_CTX }
          body = Buffer.from(JSON.stringify(parsed), "utf8")
        }
      } catch {
        // not JSON — pass through raw
      }
    }

    const headers = Object.fromEntries(
      Object.entries(req.headers).filter(
        ([key]) =>
          !["host", "content-length"].includes(
            key.toLowerCase()
          )
      )
    )

    const upstream = await client.request({
      method: req.method,
      url: `${TARGET.replace(/\/$/, "")}/${pathPart}`,
      headers,
      data: body,
      responseType: "arraybuffer",
      validateStatus: () => true,
    })

    let reqJson: any

    try {
      reqJson = body?.length
        ? JSON.parse(body.toString("utf8"))
        : null
    } catch {
      reqJson = body?.toString("utf8") ?? null
    }

    let respJson: any

    try {
      respJson = JSON.parse(
        Buffer.from(upstream.data).toString("utf8")
      )
    } catch {
      respJson = Buffer.from(upstream.data).toString("utf8")
    }

    const tokenCounts = extractTokenCounts(respJson)
    const errorInfo = classifyError(upstream.status)

    const model =
      typeof reqJson === "object" && reqJson
        ? reqJson.model ?? "unknown"
        : "unknown"

    const costInfo = calculateCost(tokenCounts, model)

    const logEntry = {
      meta: {
        ts: new Date().toISOString(),
        id: randomUUID().slice(0, 8),
        session_id: process.env.OPENCODE_SESSION_ID,
      },
      request: {
        method: req.method,
        path: `/${pathPart}`,
        body: reqJson,
        bytes: body?.length ?? 0,
      },
      response: {
        status: upstream.status,
        body: respJson,
        bytes: Buffer.byteLength(upstream.data),
        rate_limit:
          upstream.headers["x-ratelimit-limit"],
      },
      metrics: {
        tokens: tokenCounts,
        error: errorInfo,
        cost: costInfo,
      },
    }

    await appendLog(logEntry)

    const filteredHeaders = Object.fromEntries(
      Object.entries(upstream.headers).filter(
        ([key]) =>
          ![
            "transfer-encoding",
            "content-encoding",
            "content-length",
          ].includes(key.toLowerCase())
      )
    )

    Object.entries(filteredHeaders).forEach(([k, v]) => {
      if (v !== undefined) {
        res.setHeader(k, String(v))
      }
    })

    res.status(upstream.status).send(upstream.data)
  } catch (err: any) {
    console.error(err)

    res.status(500).json({
      error: err.message,
    })
  }
})

const PORT = Number(process.env.PROXY_PORT || 8080)

app.listen(PORT, () => {
  console.log(`Proxy listening on port ${PORT}`)
})
