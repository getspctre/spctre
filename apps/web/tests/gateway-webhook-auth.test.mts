import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveBySecretSpy } = vi.hoisted(() => ({ resolveBySecretSpy: vi.fn() }));

vi.mock("@/lib/repositories/gateway-webhook", () => ({
  resolveWebhookRegistrationBySecret: resolveBySecretSpy,
}));

vi.mock("@/lib/platform/config", () => ({
  evidenceIngestUrl: () => "",
  workerInternalSecret: () => "",
}));

const { resolveWebhookRegistration } = await import("../app/api/gateway-ingest/_shared");

describe("gateway webhook authentication", () => {
  beforeEach(() => {
    resolveBySecretSpy.mockReset();
  });

  it("returns the registration when the secret is registered for the route provider", async () => {
    resolveBySecretSpy.mockResolvedValue({
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      provider: "portkey",
      registrationId: "registration-1",
    });

    const request = new Request("https://app.example/api/gateway-ingest/portkey", {
      headers: { "x-portkey-webhook-secret": "secret-1" },
    });

    await expect(
      resolveWebhookRegistration(request, "x-portkey-webhook-secret", "portkey"),
    ).resolves.toEqual({
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      provider: "portkey",
      registrationId: "registration-1",
    });
    expect(resolveBySecretSpy).toHaveBeenCalledWith("secret-1");
  });

  it("rejects a valid secret registered for a different provider", async () => {
    resolveBySecretSpy.mockResolvedValue({
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      provider: "helicone",
      registrationId: "registration-1",
    });

    const request = new Request("https://app.example/api/gateway-ingest/portkey", {
      headers: { "x-portkey-webhook-secret": "secret-1" },
    });

    await expect(
      resolveWebhookRegistration(request, "x-portkey-webhook-secret", "portkey"),
    ).resolves.toBeNull();
  });
});
