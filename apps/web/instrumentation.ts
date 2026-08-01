export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertSessionGuardConfiguration } = await import("@/lib/session-guard-secret");
    assertSessionGuardConfiguration();
    const { initTelemetry } = await import("@spctre/platform/telemetry");
    initTelemetry(process.env.OTEL_SERVICE_NAME?.trim() || "spctre-web");
  }
}
