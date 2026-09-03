import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRouteRequest } from "./route-test-helper";

const {
  getActiveScopeSpy,
  getAuthSessionSpy,
  getApprovalWorkflowConfigSpy,
  getCompliancePacketSpy,
  getComplianceVerificationStatusSpy,
  isFeatureEntitledSpy,
  listAgentSurfacesSpy,
  unlinkAgentSurfaceSpy,
} = vi.hoisted(() => ({
  getActiveScopeSpy: vi.fn(),
  getAuthSessionSpy: vi.fn(),
  getApprovalWorkflowConfigSpy: vi.fn(),
  getCompliancePacketSpy: vi.fn(),
  getComplianceVerificationStatusSpy: vi.fn(),
  isFeatureEntitledSpy: vi.fn(),
  listAgentSurfacesSpy: vi.fn(),
  unlinkAgentSurfaceSpy: vi.fn(),
}));

vi.mock("@/lib/auth-session", () => ({ getAuthSession: getAuthSessionSpy }));

vi.mock("@/lib/workspace", () => ({ getActiveScope: getActiveScopeSpy }));

vi.mock("@/lib/service-tokens", () => ({
  authenticateServiceToken: vi.fn(),
  hasBearerToken: () => false,
}));

vi.mock("@/lib/entitlements/features", () => ({ isFeatureEntitled: isFeatureEntitledSpy }));

vi.mock("@/lib/domains/compliance/service", () => ({
  getCompliancePacket: getCompliancePacketSpy,
  getComplianceVerificationStatus: getComplianceVerificationStatusSpy,
}));

vi.mock("@/lib/domains/workflows/service", () => ({
  getApprovalWorkflowConfig: getApprovalWorkflowConfigSpy,
}));

vi.mock("@/lib/domains/identity/service", () => ({
  listAgentSurfaces: listAgentSurfacesSpy,
  unlinkAgentSurface: unlinkAgentSurfaceSpy,
}));

const { GET: complianceStatusGet } = await import("../app/api/compliance/status/route");
const { GET: workflowConfigGet } = await import("../app/api/workflow/config/route");
const { DELETE: agentSurfaceDelete } =
  await import("../app/api/agents/[id]/surfaces/[surfaceId]/route");

function session() {
  return { principalId: "principal-1", tenantId: "tenant-1" };
}

function activeScope() {
  return { tenantId: "tenant-1", workspaceId: "workspace-1" };
}

async function expectAuthRequired(response: Response) {
  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ error: "Authentication required." });
}

describe("shared route scope helper integrations", () => {
  beforeEach(() => {
    getActiveScopeSpy.mockReset();
    getAuthSessionSpy.mockReset();
    getApprovalWorkflowConfigSpy.mockReset();
    getCompliancePacketSpy.mockReset();
    getComplianceVerificationStatusSpy.mockReset();
    isFeatureEntitledSpy.mockReset();
    listAgentSurfacesSpy.mockReset();
    unlinkAgentSurfaceSpy.mockReset();
  });

  it("keeps compliance status unauthorized and success envelopes stable", async () => {
    getAuthSessionSpy.mockResolvedValueOnce(null);
    await expectAuthRequired(
      await complianceStatusGet(
        createRouteRequest({ path: "/api/compliance/status", method: "GET" }),
      ),
    );

    getAuthSessionSpy.mockResolvedValueOnce(session());
    getActiveScopeSpy.mockResolvedValueOnce(activeScope());
    getCompliancePacketSpy.mockResolvedValueOnce(null);

    const response = await complianceStatusGet(
      createRouteRequest({ path: "/api/compliance/status", method: "GET" }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      available: false,
      workspaceId: "workspace-1",
    });
  });

  it("keeps workflow config unauthorized and success envelopes stable", async () => {
    getAuthSessionSpy.mockResolvedValueOnce(null);
    await expectAuthRequired(
      await workflowConfigGet(createRouteRequest({ path: "/api/workflow/config", method: "GET" })),
    );

    getAuthSessionSpy.mockResolvedValueOnce(session());
    getActiveScopeSpy.mockResolvedValueOnce(activeScope());
    getApprovalWorkflowConfigSpy.mockResolvedValueOnce({ mode: "manual" });

    const response = await workflowConfigGet(
      createRouteRequest({ path: "/api/workflow/config?environment=prod", method: "GET" }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      environment: "prod",
      workflow: { mode: "manual" },
      workspaceId: "workspace-1",
    });
  });

  it("keeps agent surface delete unauthorized and success envelopes stable", async () => {
    getAuthSessionSpy.mockResolvedValueOnce(null);
    await expectAuthRequired(
      await agentSurfaceDelete(
        createRouteRequest({ path: "/api/agents/a-1/surfaces/s-1", method: "DELETE" }),
        { params: Promise.resolve({ id: "agent-1", surfaceId: "surface-1" }) },
      ),
    );

    getAuthSessionSpy.mockResolvedValueOnce(session());
    getActiveScopeSpy.mockResolvedValueOnce(activeScope());
    isFeatureEntitledSpy.mockResolvedValueOnce(true);
    listAgentSurfacesSpy.mockResolvedValueOnce([
      { id: "surface-1", surfaceType: "MCP", surfaceAgentId: "agent-surface-1" },
    ]);
    unlinkAgentSurfaceSpy.mockResolvedValueOnce(true);

    const response = await agentSurfaceDelete(
      createRouteRequest({ path: "/api/agents/a-1/surfaces/s-1", method: "DELETE" }),
      { params: Promise.resolve({ id: "agent-1", surfaceId: "surface-1" }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(unlinkAgentSurfaceSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "principal-1",
        canonicalAgentId: "agent-1",
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
      }),
    );
  });
});
