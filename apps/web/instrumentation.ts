export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateRuntimeConfig } = await import("@/lib/config/runtime");
    validateRuntimeConfig();
    const { initTelemetry } = await import("@spctre/platform/telemetry");
    initTelemetry(process.env.OTEL_SERVICE_NAME?.trim() || "spctre-web");
  }
}
