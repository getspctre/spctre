import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader, type IMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { DEFAULT_SERVICE_NAME, telemetryState } from "./observability-state.js";
import { writeLog } from "./logging.js";

function boolEnv(name: string, defaultValue = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  return ["1", "true", "yes", "on"].includes(raw);
}

function intEnv(name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}


function parseResourceAttributes(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const attrs: Record<string, string> = {};
  for (const part of raw.split(",")) {
    const [key, ...rest] = part.split("=");
    const name = key?.trim();
    const value = rest.join("=").trim();
    if (name && value) attrs[name] = value;
  }
  return attrs;
}

export function initTelemetry(serviceName = process.env.OTEL_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME): void {
  if (telemetryState.started) return;

  telemetryState.serviceName = serviceName;
  telemetryState.disabled = boolEnv("OTEL_SDK_DISABLED", false);
  if (telemetryState.disabled) {
    writeLog("info", "Telemetry SDK disabled via environment variable");
    telemetryState.started = true;
    return;
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? "0.1.0",
    ...parseResourceAttributes(process.env.OTEL_RESOURCE_ATTRIBUTES),
  });

  const metricReaders: IMetricReader[] = [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: intEnv("OTEL_METRIC_EXPORT_INTERVAL", 60000),
    }),
  ];



  telemetryState.sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter(),
    metricReaders,
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  telemetryState.sdk.start();
  writeLog("info", "Telemetry SDK started", { serviceName, resource: resource.attributes });
  telemetryState.started = true;
}

export async function shutdownTelemetry(): Promise<void> {
  if (!telemetryState.sdk) return;
  await telemetryState.sdk.shutdown();
  telemetryState.sdk = undefined;
  telemetryState.started = false;
}
