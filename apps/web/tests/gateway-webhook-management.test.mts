import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSpy, revokeSpy, listSpy, appendLogSpy } = vi.hoisted(() => ({
  createSpy: vi.fn(),
  revokeSpy: vi.fn(),
  listSpy: vi.fn(),
  appendLogSpy: vi.fn(),
}));

vi.mock("@/lib/repositories/gateway-webhook", () => ({
  createWebhookRegistration: createSpy,
  revokeWebhookRegistration: revokeSpy,
  listWebhookRegistrations: listSpy,
}));

vi.mock("@/lib/repositories/operations-log/log", () => ({
  appendOperationsLog: appendLogSpy,
}));

// Tenancy binding is exercised elsewhere; here we just run the callback inline.
vi.mock("@/lib/tenant-context", () => ({
  runWithTenantContext: (_tenantId: string, fn: () => unknown) => fn(),
}));

const {
  createGatewayWebhookRegistration,
  revokeGatewayWebhookRegistration,
  isGatewayWebhookProvider,
  GATEWAY_WEBHOOK_PROVIDERS,
} = await import("../lib/domains/gateway-webhook/service");

describe("gateway webhook management service", () => {
  beforeEach(() => {
    createSpy.mockReset();
    revokeSpy.mockReset();
    listSpy.mockReset();
    appendLogSpy.mockReset();
    appendLogSpy.mockResolvedValue(undefined);
  });

  it("only accepts providers in the supported set", () => {
    expect(isGatewayWebhookProvider("portkey")).toBe(true);
    expect(isGatewayWebhookProvider("notion")).toBe(true);
    expect(isGatewayWebhookProvider("openai")).toBe(false);
    expect(isGatewayWebhookProvider("")).toBe(false);
  });

  it("advertises provider headers that match the ingest routes", () => {
    const headers = Object.fromEntries(GATEWAY_WEBHOOK_PROVIDERS.map((p) => [p.id, p.header]));
    expect(headers).toEqual({
      portkey: "x-portkey-webhook-secret",
      helicone: "helicone-signature",
      litellm: "x-litellm-signature",
      notion: "x-notion-signature",
    });
  });

  it("mints a secret and writes a TOKEN_ISSUED audit entry", async () => {
    createSpy.mockResolvedValue({
      registration: { id: "reg-1", provider: "portkey" },
      secret: "gwh_abc",
    });

    const result = await createGatewayWebhookRegistration({
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      provider: "portkey",
      label: "prod",
      createdBy: "user-1",
    });

    expect(result.secret).toBe("gwh_abc");
    expect(createSpy).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      provider: "portkey",
      label: "prod",
      createdBy: "user-1",
    });
    expect(appendLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "TOKEN_ISSUED",
        sourceId: "reg-1",
        sourceTable: "gateway_webhook_registration",
        actorId: "user-1",
      })
    );
  });

  it("still returns the secret when the audit append fails", async () => {
    createSpy.mockResolvedValue({ registration: { id: "reg-2" }, secret: "gwh_x" });
    appendLogSpy.mockRejectedValue(new Error("chain locked"));

    await expect(
      createGatewayWebhookRegistration({
        tenantId: "t",
        workspaceId: "w",
        provider: "notion",
        createdBy: "u",
      })
    ).resolves.toMatchObject({ secret: "gwh_x" });
  });

  it("writes TOKEN_REVOKED only when a row was actually revoked", async () => {
    revokeSpy.mockResolvedValueOnce(true);
    await expect(
      revokeGatewayWebhookRegistration({ id: "reg-1", tenantId: "t", workspaceId: "w", actorId: "u" })
    ).resolves.toBe(true);
    expect(appendLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "TOKEN_REVOKED", sourceId: "reg-1" })
    );

    appendLogSpy.mockClear();
    revokeSpy.mockResolvedValueOnce(false);
    await expect(
      revokeGatewayWebhookRegistration({ id: "missing", tenantId: "t", workspaceId: "w", actorId: "u" })
    ).resolves.toBe(false);
    expect(appendLogSpy).not.toHaveBeenCalled();
  });
});
