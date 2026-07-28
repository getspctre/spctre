import {
  context,
  metrics,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Counter,
  type Histogram,
  type ObservableGauge,
  type Span,
} from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

type LogLevel = "info" | "warn" | "error";

const SERVICE_NAME = "spctre-mcp-server";
const SENSITIVE_KEY = /token|secret|password|authorization|cookie|access.?key|refresh.?key|e.?mail|phone/i;
const MAX_ATTRIBUTE_LENGTH = 300;

let serviceName = SERVICE_NAME;
let telemetry: NodeSDK | undefined;
const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();
const gauges = new Map<string, { instrument: ObservableGauge; series: Map<string, { value: number; attrs: Attributes }> }>();

function redact(value: unknown, key = "", depth = 0): unknown {
  if (key && SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (depth >= 8) return "[MaxDepth]";
  if (Array.isArray(value)) return value.map((entry) => redact(entry, "", depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [childKey, redact(childValue, childKey, depth + 1)]));
}

function attributes(input: Record<string, unknown> = {}): Attributes {
  const output: Attributes = {};
  for (const [key, value] of Object.entries(input)) {
    const safe = redact(value, key);
    if (safe === null || safe === undefined) continue;
    if (typeof safe === "string") output[key] = safe.length > MAX_ATTRIBUTE_LENGTH ? `${safe.slice(0, MAX_ATTRIBUTE_LENGTH)}...` : safe;
    else if (typeof safe === "number" || typeof safe === "boolean") output[key] = safe;
    else output[key] = JSON.stringify(safe).slice(0, MAX_ATTRIBUTE_LENGTH);
  }
  return output;
}

function writeLog(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  const span = trace.getActiveSpan()?.spanContext();
  const payload = { ts: new Date().toISOString(), level, message, "service.name": serviceName, ...(span ? { trace_id: span.traceId, span_id: span.spanId } : {}), ...attributes(fields) };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, fields?: Record<string, unknown>) => writeLog("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => writeLog("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => writeLog("error", message, fields),
};

export function incrementCounter(name: string, value = 1, attrs: Record<string, unknown> = {}): void {
  let counter = counters.get(name);
  if (!counter) {
    counter = metrics.getMeter(serviceName).createCounter(name);
    counters.set(name, counter);
  }
  counter.add(value, attributes(attrs));
}

export function recordDuration(name: string, valueMs: number, attrs: Record<string, unknown> = {}): void {
  let histogram = histograms.get(name);
  if (!histogram) {
    histogram = metrics.getMeter(serviceName).createHistogram(name, { unit: "ms" });
    histograms.set(name, histogram);
  }
  histogram.record(valueMs, attributes(attrs));
}

export function setGauge(name: string, value: number, attrs: Record<string, unknown> = {}): void {
  let gauge = gauges.get(name);
  if (!gauge) {
    const series = new Map<string, { value: number; attrs: Attributes }>();
    const instrument = metrics.getMeter(serviceName).createObservableGauge(name);
    instrument.addCallback((result) => { for (const entry of series.values()) result.observe(entry.value, entry.attrs); });
    gauge = { instrument, series };
    gauges.set(name, gauge);
  }
  const safeAttrs = attributes(attrs);
  gauge.series.set(JSON.stringify(safeAttrs), { value, attrs: safeAttrs });
}

export async function withSpan<T>(name: string, attrs: Record<string, unknown>, fn: (span: Span) => Promise<T> | T): Promise<T> {
  const span = trace.getTracer(serviceName).startSpan(name, { kind: SpanKind.INTERNAL, attributes: attributes(attrs) });
  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const result = await fn(span);
      span.setStatus({ code: result instanceof Response && result.status >= 400 ? SpanStatusCode.ERROR : SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function initTelemetry(name = process.env.OTEL_SERVICE_NAME?.trim() || SERVICE_NAME): void {
  if (telemetry || process.env.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true") return;
  serviceName = name;
  telemetry = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName, [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? "0.1.0" }),
    traceExporter: new OTLPTraceExporter(),
    metricReaders: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), exportIntervalMillis: Number.parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? "60000", 10) || 60000 })],
    instrumentations: [getNodeAutoInstrumentations({ "@opentelemetry/instrumentation-fs": { enabled: false } })],
  });
  telemetry.start();
  logger.info("Telemetry SDK started", { serviceName });
}

export async function shutdownTelemetry(): Promise<void> {
  await telemetry?.shutdown();
  telemetry = undefined;
}
