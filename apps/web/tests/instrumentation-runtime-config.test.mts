import { afterEach, describe, expect, it, vi } from "vitest";

const validateRuntimeConfigMock = vi.fn();
const assertSessionGuardConfigurationMock = vi.fn();
const initTelemetryMock = vi.fn();

vi.mock("@/lib/config/runtime", () => ({ validateRuntimeConfig: validateRuntimeConfigMock }));
vi.mock("@/lib/session-guard-secret", () => ({
  assertSessionGuardConfiguration: assertSessionGuardConfigurationMock,
}));
vi.mock("@spctre/platform/telemetry", () => ({ initTelemetry: initTelemetryMock }));

const originalRuntime = process.env.NEXT_RUNTIME;
afterEach(() => {
  validateRuntimeConfigMock.mockReset();
  assertSessionGuardConfigurationMock.mockReset();
  initTelemetryMock.mockReset();
  if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = originalRuntime;
});

describe("instrumentation runtime configuration", () => {
  it("validates both runtime policy and session guard configuration before telemetry", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const { register } = await import("../instrumentation");

    await register();

    expect(validateRuntimeConfigMock).toHaveBeenCalledOnce();
    expect(assertSessionGuardConfigurationMock).toHaveBeenCalledOnce();
    expect(initTelemetryMock).toHaveBeenCalledOnce();
  });
});
