import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The offline path in lib/platform/sms.ts issues a placeholder sessionInfo and
// then accepts any six-digit code against it. That is a working authentication
// bypass, so these tests pin the one thing that keeps it out of production.

const PRODUCTION_ENV = {
  NODE_ENV: "production",
  SPCTRE_RUNTIME_MODE: "production",
  SPCTRE_SESSION_GUARD_SECRET: "test-session-guard-secret",
} as const;

const originalEnv = { ...process.env };

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function importSms() {
  vi.resetModules();
  return import("../lib/platform/sms.js");
}

beforeEach(() => {
  delete process.env.FIREBASE_API_KEY;
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("SMS MFA offline fallback", () => {
  it("refuses to issue an unverifiable enrollment in a production runtime", async () => {
    setEnv(PRODUCTION_ENV);
    const { sendSmsOtp } = await importSms();

    await expect(sendSmsOtp("+15555550100")).rejects.toThrow(/FIREBASE_API_KEY/);
  });

  it("rejects every six-digit code in a production runtime", async () => {
    setEnv(PRODUCTION_ENV);
    const { verifyFirebasePhoneAuth } = await importSms();

    // Including an enrollment that already holds the placeholder token, which
    // is what a stack carries if it ran the offline path before this guard.
    for (const code of ["000000", "123456", "999999"]) {
      expect(await verifyFirebasePhoneAuth("dev-session-info", code)).toBe(false);
    }
  });

  it("still works offline in development, which is the only place it should", async () => {
    setEnv({ NODE_ENV: "development", SPCTRE_RUNTIME_MODE: undefined });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { sendSmsOtp, verifyFirebasePhoneAuth } = await importSms();

    const sessionInfo = await sendSmsOtp("+15555550100");
    expect(sessionInfo).toBe("dev-session-info");
    expect(await verifyFirebasePhoneAuth(sessionInfo, "123456")).toBe(true);
    // The placeholder is still required: an arbitrary token is not accepted.
    expect(await verifyFirebasePhoneAuth("other-token", "123456")).toBe(false);
  });
});
