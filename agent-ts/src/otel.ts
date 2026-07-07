import { NodeSDK } from '@opentelemetry/sdk-node'
import { Resource } from '@opentelemetry/resources'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'

const resource = Resource.default().merge(
  new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: process.env.DD_SERVICE || 'agent-ts',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.DD_ENV || 'dev',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
  })
)

const traceExporter = new OTLPTraceExporter({
  url: process.env.DD_TRACE_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
  headers: {
    'dd-api-key': process.env.DD_API_KEY || '',
  },
})

const metricExporter = new OTLPMetricExporter({
  url: process.env.DD_METRIC_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/metrics',
  headers: {
    'dd-api-key': process.env.DD_API_KEY || '',
  },
})

const sdk = new NodeSDK({
  resource,
  traceExporter,
  metricReader: new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 10000,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': { enabled: true },
      '@opentelemetry/instrumentation-express': { enabled: true },
    }),
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
  ],
})

export function initializeOtel() {
  sdk.start()
  console.log('OpenTelemetry initialized')
  return sdk
}
