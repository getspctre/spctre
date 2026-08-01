import { afterEach, describe, expect, it } from "vitest";

const originalEnvironment = {
  nodeEnv: process.env.NODE_ENV,
  sessionGuardSecret: process.env.SPCTRE_SESSION_GUARD_SECRET,
  developmentSecret: process.env.SPCTRE_DEV_SESSION_GUARD_SECRET,
};

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore("NODE_ENV", originalEnvironment.nodeEnv);
  restore("SPCTRE_SESSION_GUARD_SECRET", originalEnvironment.sessionGuardSecret);
  restore("SPCTRE_DEV_SESSION_GUARD_SECRET", originalEnvironment.developmentSecret);
});

describe("session-guard secret resolution", () => {
  it("uses the configured production secret", async () => {
    process.env.NODE_ENV = "production";
    process.env.SPCTRE_SESSION_GUARD_SECRET = "configured-secret";
    delete process.env.SPCTRE_DEV_SESSION_GUARD_SECRET;

    const { getSessionGuardSecret } = await import("../lib/session-guard-secret");
    expect(getSessionGuardSecret()).toBe("configured-secret");
  });

  it("allows a development secret only with explicit local opt-in", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.SPCTRE_SESSION_GUARD_SECRET;
    process.env.SPCTRE_DEV_SESSION_GUARD_SECRET = "local-secret";

    const { getSessionGuardSecret } = await import("../lib/session-guard-secret");
    expect(getSessionGuardSecret()).toBe("local-secret");
  });

  it("fails closed when production has no configured secret", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.SPCTRE_SESSION_GUARD_SECRET;
    delete process.env.SPCTRE_DEV_SESSION_GUARD_SECRET;

    const { assertSessionGuardConfiguration, getSessionGuardSecret } = await import("../lib/session-guard-secret");
    expect(() => getSessionGuardSecret()).toThrow("SPCTRE_SESSION_GUARD_SECRET is required.");
    expect(() => assertSessionGuardConfiguration()).toThrow("SPCTRE_SESSION_GUARD_SECRET is required.");
  });
});
