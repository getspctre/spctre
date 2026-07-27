import type { NodeSDK } from "@opentelemetry/sdk-node";

export interface TelemetryState {
  serviceName: string;
  sdk?: NodeSDK;
  started: boolean;
  disabled: boolean;
}

export const DEFAULT_SERVICE_NAME = "spctre";

export const telemetryState: TelemetryState = {
  serviceName: process.env.OTEL_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME,
  started: false,
  disabled: false,
};

export function currentServiceName(): string {
  return telemetryState.serviceName || DEFAULT_SERVICE_NAME;
}
