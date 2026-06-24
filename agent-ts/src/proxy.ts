import express, { Request, Response } from "express"
import axios, { AxiosInstance } from "axios"
import dotenv from "dotenv"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { randomUUID } from "crypto"

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

  try {
    const targetUrl = `${TARGET.replace(/\/$/, "")}${req.path}`

    const response = await client.request({
      method: req.method,
      url: targetUrl,
      headers,
      data: body,
      responseType: "arraybuffer",
    })

    let reqJson: unknown = null
    let respJson: unknown = null

    try {
      reqJson = body?.length ? JSON.parse(body.toString("utf8")) : null
    } catch {
      reqJson = body?.length ? body.toString("utf8") : null
    }

    try {
      respJson = JSON.parse(Buffer.from(response.data as ArrayBuffer).toString("utf8"))
    } catch {
      respJson = Buffer.from(response.data as ArrayBuffer).toString("utf8")
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

    res.status(500).json({ error: err.message })
  }
})

const PORT = process.env.PROXY_PORT || 8080
app.listen(PORT, () => {
  console.log(`HTTP proxy listening on http://localhost:${PORT}`)
  console.log(`Forwarding to: ${TARGET}`)
  console.log(`Logging to:    ${LOG_FILE}`)
})
