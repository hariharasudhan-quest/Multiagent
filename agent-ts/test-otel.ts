import { initializeOtel } from "./src/otel.js"
import { trace } from "@opentelemetry/api"

const sdk = initializeOtel()
const tracer = trace.getTracer("test-tracer")
const span = tracer.startSpan("test-span")
span.addEvent("testing")
span.end()
console.log("Span ended. Shutting down SDK to flush...")
sdk.shutdown().then(() => console.log("Flushed!")).catch(console.error)
