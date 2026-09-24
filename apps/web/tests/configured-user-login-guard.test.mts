import { afterEach, describe, expect, it } from "vitest";
import { isConfiguredUserLoginEnabled } from "../lib/auth-login-modes.js";

// loginWithPrincipal signs in on a principal id alone. These pin the only
// thing standing between that and a reachable deployment.

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function env(values: Record<string, string | undefined>) {
  for (const key of ["NODE_ENV", "SPCTRE_RUNTIME_MODE", "SPCTRE_ENABLE_CONFIGURED_USER_LOGIN"]) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
}

describe("configured-user login", () => {
  it("is off when NODE_ENV says production", () => {
    env({ NODE_ENV: "production" });
    expect(isConfiguredUserLoginEnabled()).toBe(false);
  });

  it("is off when the runtime mode says production and NODE_ENV has drifted", () => {
    // The case the NODE_ENV-only gate missed: runtime mode is declared, but
    // NODE_ENV was lost by the image or the orchestrator.
    env({ SPCTRE_RUNTIME_MODE: "production" });
    expect(isConfiguredUserLoginEnabled()).toBe(false);

    env({ NODE_ENV: "development", SPCTRE_RUNTIME_MODE: "production" });
    expect(isConfiguredUserLoginEnabled()).toBe(false);

    // An explicit opt-in must not override a production runtime either.
    env({ SPCTRE_RUNTIME_MODE: "production", SPCTRE_ENABLE_CONFIGURED_USER_LOGIN: "true" });
    expect(isConfiguredUserLoginEnabled()).toBe(false);
  });

  it("stays available for local development, on by default", () => {
    env({ NODE_ENV: "development" });
    expect(isConfiguredUserLoginEnabled()).toBe(true);

    env({ NODE_ENV: "development", SPCTRE_ENABLE_CONFIGURED_USER_LOGIN: "false" });
    expect(isConfiguredUserLoginEnabled()).toBe(false);
  });
});
