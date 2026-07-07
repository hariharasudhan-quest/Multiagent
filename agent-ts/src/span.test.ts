import { describe, it, expect, beforeEach } from "vitest"
import { AgentSpan, consoleExporter, SpanStatus, type SpanContext } from "./span"

describe("AgentSpan", () => {
  let mockExporter: any
  let exportedSpans: any[] = []

  beforeEach(() => {
    exportedSpans = []
    mockExporter = {
      export: (span: any) => {
        exportedSpans.push(span)
      },
    }
  })

  describe("Span Creation", () => {
    it("should create a root span with new trace ID", () => {
      const span = AgentSpan.root("test.span", "task-123", "session-456", mockExporter)
      const ctx = span.getContext()

      expect(ctx.traceId).toBeDefined()
      expect(ctx.traceId.length).toBe(32)
      expect(ctx.spanId).toBeDefined()
      expect(ctx.spanId.length).toBe(16)
      expect(ctx.parentSpanId).toBeUndefined()
    })

    it("should create a child span with parent context", () => {
      const parentCtx: SpanContext = {
        traceId: "trace-12345678901234567890123456789012",
        spanId: "parent-1234567890",
      }
      const span = AgentSpan.child(parentCtx, "child.span", "task-123", "session-456", mockExporter)
      const ctx = span.getContext()

      expect(ctx.traceId).toBe(parentCtx.traceId)
      expect(ctx.spanId).not.toBe(parentCtx.spanId)
      expect(ctx.parentSpanId).toBe(parentCtx.spanId)
    })
  })

  describe("Attributes", () => {
    it("should set agent attributes", () => {
      const span = AgentSpan.root("test.span", undefined, undefined, mockExporter)
      span.setAgent("architect", "architect-used")

      const data = span.getData()
      expect(data.attributes["agent.name"]).toBe("architect")
      expect(data.attributes["agent.used"]).toBe("architect-used")
    })

    it("should set model attributes", () => {
      const span = AgentSpan.root("test.span", undefined, undefined, mockExporter)
      span.setModel("qwen3:8b", "ollama")

      const data = span.getData()
      expect(data.attributes["model.id"]).toBe("qwen3:8b")
      expect(data.attributes["model.provider"]).toBe("ollama")
    })

    it("should set phase attributes", () => {
      const span = AgentSpan.root("test.span", undefined, undefined, mockExporter)
      span.setPhase("implementation", "primary")

      const data = span.getData()
      expect(data.attributes["phase.name"]).toBe("implementation")
      expect(data.attributes["phase.type"]).toBe("primary")
    })

    it("should compute total tokens from input/output", () => {
      const span = AgentSpan.root("test.span", undefined, undefined, mockExporter)
      span.recordTokenUsage(100, 50)

      const data = span.getData()
      expect(data.attributes["token.input"]).toBe(100)
      expect(data.attributes["token.output"]).toBe(50)
      expect(data.attributes["token.total"]).toBe(150)
    })

    it("should record files modified as array", () => {
      const span = AgentSpan.root("test.span", undefined, undefined, mockExporter)
      const files = ["file1.ts", "file2.ts"]
      span.recordFilesModified(files)

      const data = span.getData()
      expect(data.attributes["files.modified.count"]).toBe(2)
      expect(data.attributes["files.modified.list"]).toEqual(files)
    })

    it("should record streaming metrics", () => {
      const span = AgentSpan.root("test.span", undefined, undefined, mockExporter)
      span.recordTTFT(150)
      span.recordStreamingDuration(2000)
      span.recordTokensPerSecond(25.5)

      const data = span.getData()
      expect(data.attributes["llm.ttft.ms"]).toBe(150)
      expect(data.attributes["llm.stream.duration.ms"]).toBe(2000)
      expect(data.attributes["llm.tokens.per.second"]).toBe(25.5)
    })
  })

  describe("Events", () => {
    it("should add events with timestamp", () => {
      const span = AgentSpan.root("test.span", undefined, undefined, mockExporter)
      const beforeTime = Date.now()
      span.addEvent("test.event", { key: "value" })
      const afterTime = Date.now()

      const data = span.getData()
      expect(data.events).toHaveLength(1)
      expect(data.events[0].name).toBe("test.event")
      expect(data.events[0].attributes).toEqual({ key: "value" })
      expect(data.events[0].timestamp).toBeGreaterThanOrEqual(beforeTime)
      expect(data.events[0].timestamp).toBeLessThanOrEqual(afterTime)
    })

    it("should not add events after span is ended", () => {
      const span = AgentSpan.root("test.span", undefined, undefined, mockExporter)
      span.end()
      span.addEvent("should.not.be.added")

      const data = span.getData()
      expect(data.events).toHaveLength(0)
    })
  })

  describe("Status", () => {
    it("should mark success", () => {
      const span = AgentSpan.root("test.span", undefined, undefined, mockExporter)
      span.markSuccess()

      const data = span.getData()
      expect(data.status.code).toBe(SpanStatus.OK)
    })

    it("should mark error with message", () => {
      const span = AgentSpan.root("test.span", undefined, undefined, mockExporter)
      span.markError("Something went wrong")

      const data = span.getData()
      expect(data.status.code).toBe(SpanStatus.ERROR)
      expect(data.status.message).toBe("Something went wrong")
    })

    it("should mark cancelled", () => {
      const span = AgentSpan.root("test.span", undefined, undefined, mockExporter)
      span.markCancelled("User cancelled")

      const data = span.getData()
      expect(data.status.code).toBe(SpanStatus.CANCELLED)
      expect(data.status.message).toBe("User cancelled")
    })

    it("should set custom status", () => {
      const span = AgentSpan.root("test.span", undefined, undefined, mockExporter)
      span.setStatus(SpanStatus.ERROR, "Custom error")

      const data = span.getData()
      expect(data.status.code).toBe(SpanStatus.ERROR)
      expect(data.status.message).toBe("Custom error")
    })
  })

  describe("Lifecycle", () => {
    it("should end span and export data", () => {
      const span = AgentSpan.root("test.span", "task-123", "session-456", mockExporter)
      span.setAgent("architect")
      span.markSuccess()

      const result = span.end()

      expect(exportedSpans).toHaveLength(1)
      expect(exportedSpans[0].name).toBe("test.span")
      expect(exportedSpans[0].taskId).toBe("task-123")
      expect(exportedSpans[0].sessionId).toBe("session-456")
      expect(exportedSpans[0].status.code).toBe(SpanStatus.OK)
      expect(result.durationMs).toBeGreaterThan(0)
    })

    it("should be idempotent - calling end twice should not re-export", () => {
      const span = AgentSpan.root("test.span", undefined, undefined, mockExporter)
      span.markSuccess()

      span.end()
      span.end()

      expect(exportedSpans).toHaveLength(1)
    })

    it("should return frozen data on second end call", () => {
      const span = AgentSpan.root("test.span", undefined, undefined, mockExporter)
      span.markSuccess()

      const firstEnd = span.end()
      const secondEnd = span.end()

      expect(firstEnd.durationMs).toBe(secondEnd.durationMs)
      expect(firstEnd.endTime).toBe(secondEnd.endTime)
    })

    it("should calculate duration correctly", async () => {
      const span = AgentSpan.root("test.span", undefined, undefined, mockExporter)
      await new Promise((resolve) => setTimeout(resolve, 100))
      const data = span.end()

      expect(data.durationMs).toBeGreaterThanOrEqual(90)
      expect(data.durationMs).toBeLessThan(200)
    })
  })

  describe("Data Inspection", () => {
    it("should return data without ending span", () => {
      const span = AgentSpan.root("test.span", "task-123", undefined, mockExporter)
      span.setAgent("architect")

      const data = span.getData()

      expect(data.name).toBe("test.span")
      expect(data.taskId).toBe("task-123")
      expect(data.attributes["agent.name"]).toBe("architect")
      expect(exportedSpans).toHaveLength(0) // Not exported yet
    })

    it("should include all required fields in SpanData", () => {
      const span = AgentSpan.root("test.span", "task-123", "session-456", mockExporter)
      const data = span.getData()

      expect(data).toHaveProperty("spanId")
      expect(data).toHaveProperty("traceId")
      expect(data).toHaveProperty("name")
      expect(data).toHaveProperty("startTime")
      expect(data).toHaveProperty("endTime")
      expect(data).toHaveProperty("durationMs")
      expect(data).toHaveProperty("attributes")
      expect(data).toHaveProperty("events")
      expect(data).toHaveProperty("status")
      expect(data).toHaveProperty("taskId")
      expect(data).toHaveProperty("sessionId")
    })
  })
})
