import { afterEach, describe, expect, it } from "vitest";
import {
  getRuntimeConfig,
  resetRuntimeConfigCacheForTests,
  validateRuntimeConfig,
} from "../lib/config/runtime";

const productionEnvironment = {
  NODE_ENV: "production",
  SPCTRE_RUNTIME_MODE: "production",
  SPCTRE_SESSION_GUARD_SECRET: "production-secret",
};

const originalEnvironment = {
  nodeEnv: process.env.NODE_ENV,
  runtimeMode: process.env.SPCTRE_RUNTIME_MODE,
  plan: process.env.SPCTRE_PLAN,
  sessionGuardSecret: process.env.SPCTRE_SESSION_GUARD_SECRET,
  e2eApiEnabled: process.env.SPCTRE_E2E_API_ENABLED,
};

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  resetRuntimeConfigCacheForTests();
  restore("NODE_ENV", originalEnvironment.nodeEnv);
  restore("SPCTRE_RUNTIME_MODE", originalEnvironment.runtimeMode);
  restore("SPCTRE_PLAN", originalEnvironment.plan);
  restore("SPCTRE_SESSION_GUARD_SECRET", originalEnvironment.sessionGuardSecret);
  restore("SPCTRE_E2E_API_ENABLED", originalEnvironment.e2eApiEnabled);
});

describe("runtime configuration", () => {
  it("rejects a production Node process without an explicit runtime mode", () => {
    expect(() => getRuntimeConfig({ NODE_ENV: "production" })).toThrow(
      "SPCTRE_RUNTIME_MODE is required",
    );
  });

  it("rejects an invalid plan before production starts", () => {
    expect(() => getRuntimeConfig({ ...productionEnvironment, SPCTRE_PLAN: "ent" })).toThrow(
      "SPCTRE_PLAN must be",
    );
  });

  it("refuses to start a production runtime with the E2E support API enabled", () => {
    expect(() =>
      getRuntimeConfig({ ...productionEnvironment, SPCTRE_E2E_API_ENABLED: "true" }),
    ).toThrow("SPCTRE_E2E_API_ENABLED cannot be set in a production runtime.");
  });

  it("rejects the E2E support API in production however the flag is spelled", () => {
    for (const raw of ["1", "yes", "on", "TRUE"]) {
      expect(() =>
        getRuntimeConfig({ ...productionEnvironment, SPCTRE_E2E_API_ENABLED: raw }),
      ).toThrow("SPCTRE_E2E_API_ENABLED cannot be set in a production runtime.");
    }
  });

  it("allows the E2E support API in a development runtime", () => {
    expect(getRuntimeConfig({ SPCTRE_E2E_API_ENABLED: "true" }).e2eApiEnabled).toBe(true);
  });

  it("leaves the E2E support API off by default", () => {
    expect(getRuntimeConfig(productionEnvironment).e2eApiEnabled).toBe(false);
  });

  it("rejects a production runtime without a session guard secret", () => {
    expect(() =>
      getRuntimeConfig({ NODE_ENV: "production", SPCTRE_RUNTIME_MODE: "production" }),
    ).toThrow("SPCTRE_SESSION_GUARD_SECRET is required");
  });

  it("allows explicit production demo and single-tenant configuration", () => {
    const config = getRuntimeConfig({
      ...productionEnvironment,
      SPCTRE_ENABLE_DEMO_TENANT: "true",
      SPCTRE_SINGLE_TENANT_MODE: "true",
      SPCTRE_DEFAULT_TENANT_ID: "123e4567-e89b-12d3-a456-426614174000",
      SPCTRE_PLAN: "business",
    });

    expect(config).toMatchObject({ mode: "production", demoTenantEnabled: true, plan: "business" });
  });

  it("caches only the validated process environment", () => {
    process.env.NODE_ENV = "production";
    process.env.SPCTRE_RUNTIME_MODE = "production";
    process.env.SPCTRE_SESSION_GUARD_SECRET = "production-secret";
    process.env.SPCTRE_PLAN = "cloud";

    expect(validateRuntimeConfig().plan).toBe("cloud");
    process.env.SPCTRE_PLAN = "enterprise";

    expect(getRuntimeConfig().plan).toBe("cloud");
    expect(getRuntimeConfig({ ...productionEnvironment, SPCTRE_PLAN: "enterprise" }).plan).toBe(
      "enterprise",
    );
  });
});
