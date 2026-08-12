import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRouteRequest } from "./route-test-helper";
import { DEMO_TENANT_ID } from "../lib/demo";

const getAuthSessionSpy = vi.fn();
const createTotpEnrollmentSpy = vi.fn();
const createSmsEnrollmentSpy = vi.fn();
const generateRecoveryCodesSpy = vi.fn();

vi.mock("@/lib/auth-session", () => ({ getAuthSession: getAuthSessionSpy }));

vi.mock("@/lib/domains/auth/service", () => ({
  isAuthDatabaseConfigured: () => true,
  createTotpEnrollment: createTotpEnrollmentSpy,
  createSmsEnrollment: createSmsEnrollmentSpy,
  isSmsCooldownActive: vi.fn(),
  generateRecoveryCodes: generateRecoveryCodesSpy,
  upsertPasskeyCredential: vi.fn(),
}));

vi.mock("@/lib/feature-flags-server", () => ({ getSpctrePlan: () => "enterprise" }));

vi.mock("@/lib/platform/sms", () => ({ sendSmsOtp: vi.fn() }));

const totpStartRoute = await import("../app/api/auth/mfa/enroll-totp/start/route");
const smsStartRoute = await import("../app/api/auth/mfa/enroll-sms/start/route");
const passkeyStartRoute = await import("../app/api/auth/passkey/register/start/route");
const recoveryGenerateRoute = await import("../app/api/auth/recovery/generate/route");

function demoSession() {
  return {
    sessionId: "session-demo",
    tenantId: DEMO_TENANT_ID,
    principalId: "principal-demo",
    subject: "demo-owner",
    email: "owner@example.test",
    requireMfa: false,
    mfaVerified: true,
  };
}

describe("auth demo route boundary", () => {
  beforeEach(() => {
    getAuthSessionSpy.mockResolvedValue(demoSession());
    createTotpEnrollmentSpy.mockReset();
    createSmsEnrollmentSpy.mockReset();
    generateRecoveryCodesSpy.mockReset();
  });

  it("blocks TOTP enrollment for the demo tenant before writing enrollment state", async () => {
    const response = await totpStartRoute.POST();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "TOTP enrollment is not available in Demo Mode.",
    });
    expect(createTotpEnrollmentSpy).not.toHaveBeenCalled();
  });

  it("blocks SMS enrollment for the demo tenant before sending or writing enrollment state", async () => {
    const response = await smsStartRoute.POST(
      createRouteRequest({
        path: "/api/auth/mfa/enroll-sms/start",
        body: { phoneNumber: "+15555550100", recaptchaToken: "token" },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "SMS enrollment is not available in Demo Mode.",
    });
    expect(createSmsEnrollmentSpy).not.toHaveBeenCalled();
  });

  it("blocks passkey registration for the demo tenant before issuing a challenge", async () => {
    const response = await passkeyStartRoute.POST();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Passkey registration is not available in Demo Mode.",
    });
  });

  it("blocks recovery code generation for the demo tenant before creating codes", async () => {
    const response = await recoveryGenerateRoute.POST();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Recovery code generation is not available in Demo Mode.",
    });
    expect(generateRecoveryCodesSpy).not.toHaveBeenCalled();
  });
});
