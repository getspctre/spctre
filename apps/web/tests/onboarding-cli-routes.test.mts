import { beforeEach, describe, expect, it, vi } from "vitest";

const startCliOnboardingSpy = vi.fn();
const exchangeCliOnboardingCodeSpy = vi.fn();

vi.mock("@/lib/onboarding", () => ({
  startCliOnboarding: startCliOnboardingSpy,
  exchangeCliOnboardingCode: exchangeCliOnboardingCodeSpy,
}));

const startRoute = await import("../app/api/onboarding/cli/start/route");
const exchangeRoute = await import("../app/api/onboarding/cli/exchange/route");

describe("CLI onboarding routes", () => {
  beforeEach(() => {
    startCliOnboardingSpy.mockReset();
    exchangeCliOnboardingCodeSpy.mockReset();
  });

  it("starts a browser approval request", async () => {
    startCliOnboardingSpy.mockResolvedValue({
      code: "abc123",
      approveUrl: "http://localhost:3000/onboarding/cli/approve?code=abc123",
      expiresAt: "2026-05-06T00:10:00.000Z",
    });

    const response = await startRoute.POST(
      new Request("http://localhost:3000/api/onboarding/cli/start", {
        method: "POST",
        body: JSON.stringify({
          controlPlaneUrl: "http://localhost:3000",
          workspaceSlug: "default",
          agentId: "solo-agent",
          environment: "production",
          bundlePath: "spctre-policy.json",
        }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ code: "abc123" });
    expect(startCliOnboardingSpy).toHaveBeenCalledWith({
      controlPlaneUrl: "http://localhost:3000",
      workspaceSlug: "default",
      agentId: "solo-agent",
      environment: "production",
      bundlePath: "spctre-policy.json",
    });
  });

  it("returns pending while the CLI approval has not been approved", async () => {
    exchangeCliOnboardingCodeSpy.mockRejectedValue(
      new Error("CLI onboarding request is waiting for browser approval."),
    );

    const response = await exchangeRoute.POST(
      new Request("http://localhost:3000/api/onboarding/cli/exchange", {
        method: "POST",
        body: JSON.stringify({ code: "abc123" }),
      }),
    );

    expect(response.status).toBe(202);
  });

  it("exchanges an approved code once", async () => {
    exchangeCliOnboardingCodeSpy.mockResolvedValue({
      token: "spctre_dev_token",
      tokenId: "tok_1",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      workspaceSlug: "default",
      agentId: "solo-agent",
      artifactHash: "sha256:starter",
    });

    const response = await exchangeRoute.POST(
      new Request("http://localhost:3000/api/onboarding/cli/exchange", {
        method: "POST",
        body: JSON.stringify({ code: "abc123" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      token: "spctre_dev_token",
      workspaceId: "workspace-1",
    });
    expect(exchangeCliOnboardingCodeSpy).toHaveBeenCalledWith("abc123");
  });
});
