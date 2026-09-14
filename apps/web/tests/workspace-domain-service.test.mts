import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyWorkspaceOwnershipSpy = vi.fn();
const listWorkspaceSlugsWithPrefixSpy = vi.fn();
const insertWorkspaceSpy = vi.fn();
const getFirstWorkspaceIdSpy = vi.fn();
const insertAdminAuditEventSpy = vi.fn();
const countTenantWorkspacesSpy = vi.fn();
const getCommercialProfileSpy = vi.fn();
const ensureAuthDemoTenantSpy = vi.fn();
const getTenantRequireMfaSpy = vi.fn();
const getPrincipalSubjectSpy = vi.fn();
const getTenantPrincipalBySubjectSpy = vi.fn();
const updateSessionForTenantSwitchSpy = vi.fn();
const updateSessionForActorSwitchSpy = vi.fn();
const ensureDefaultPublishedPolicyPackSpy = vi.fn();
const findActorByIdSpy = vi.fn();
const verifyWriteAccessSpy = vi.fn();
const isDatabaseConfiguredSpy = vi.fn();
const checkSlugInUseSpy = vi.fn();
const updateWorkspaceDetailsSpy = vi.fn();
const deleteWorkspaceByIdSpy = vi.fn();
const resolvePlanEntitlementsSpy = vi.fn();
const listWorkspacesForTenantSpy = vi.fn();

vi.mock("@/lib/repositories/workspace", () => ({
  verifyWorkspaceOwnership: verifyWorkspaceOwnershipSpy,
  listWorkspaceSlugsWithPrefix: listWorkspaceSlugsWithPrefixSpy,
  insertWorkspace: insertWorkspaceSpy,
  getFirstWorkspaceId: getFirstWorkspaceIdSpy,
  insertAdminAuditEvent: insertAdminAuditEventSpy,
  countTenantWorkspaces: countTenantWorkspacesSpy,
  getCommercialProfile: getCommercialProfileSpy,
  checkSlugInUse: checkSlugInUseSpy,
  updateWorkspaceDetails: updateWorkspaceDetailsSpy,
  deleteWorkspaceById: deleteWorkspaceByIdSpy,
  listWorkspacesForTenant: listWorkspacesForTenantSpy,
}));
vi.mock("@/lib/ee-adapters/entitlement-catalog", () => ({
  resolvePlanEntitlements: resolvePlanEntitlementsSpy,
}));
vi.mock("@/lib/repositories/auth/principal", () => ({
  getPrincipalSubject: getPrincipalSubjectSpy,
}));
vi.mock("@/lib/repositories/auth/session", () => ({
  ensureAuthDemoTenant: ensureAuthDemoTenantSpy,
  getTenantRequireMfa: getTenantRequireMfaSpy,
  getTenantPrincipalBySubject: getTenantPrincipalBySubjectSpy,
  updateSessionForTenantSwitch: updateSessionForTenantSwitchSpy,
  updateSessionForActorSwitch: updateSessionForActorSwitchSpy,
}));
vi.mock("@/lib/repositories/default-policy", () => ({
  ensureDefaultPublishedPolicyPack: ensureDefaultPublishedPolicyPackSpy,
}));
vi.mock("@/lib/actors", () => ({ findActorById: findActorByIdSpy }));
vi.mock("@/lib/demo-guard", () => ({ verifyWriteAccess: verifyWriteAccessSpy }));
vi.mock("@/lib/repositories/shared/database", () => ({
  isDatabaseConfigured: isDatabaseConfiguredSpy,
}));

const service = await import("../lib/domains/workspace/service");

describe("workspace domain service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    isDatabaseConfiguredSpy.mockReturnValue(true);
    verifyWriteAccessSpy.mockReturnValue({ allowed: true });
    getCommercialProfileSpy.mockResolvedValue(null);
    countTenantWorkspacesSpy.mockResolvedValue(0);
    findActorByIdSpy.mockResolvedValue({ reviewerRoles: ["Admin"] });
    listWorkspaceSlugsWithPrefixSpy.mockResolvedValue([]);
    insertAdminAuditEventSpy.mockResolvedValue(undefined);
    // The default is a deployment with a commercial catalog. A deployment
    // without one resolves unlimited, which the OSS case below covers.
    resolvePlanEntitlementsSpy.mockResolvedValue({
      displayName: "Hosted Trial",
      workspaces: { value: 1, enforced: true },
      retainedEvents: { value: 1_000, enforced: true },
      retentionWindowDays: { value: 90, enforced: true },
      simulationEvents: { value: null, enforced: false },
    });
  });

  describe("switchWorkspace", () => {
    it("returns error if workspace not found", async () => {
      verifyWorkspaceOwnershipSpy.mockResolvedValue(false);
      const result = await service.switchWorkspace({ workspaceId: "ws1", tenantId: "t1" });
      expect(result).toEqual({ error: "Workspace not found." });
    });

    it("returns ok if workspace exists", async () => {
      verifyWorkspaceOwnershipSpy.mockResolvedValue(true);
      const result = await service.switchWorkspace({ workspaceId: "ws1", tenantId: "t1" });
      expect(result).toEqual({ ok: true });
    });
  });

  describe("createWorkspace", () => {
    it("enforces free tier limit", async () => {
      getCommercialProfileSpy.mockResolvedValue({ planCode: "HOSTED_TRIAL" });
      countTenantWorkspacesSpy.mockResolvedValue(1);

      const result = await service.createWorkspace({
        tenantId: "t1",
        principalId: "p1",
        workspaceName: "My Ws",
      });

      expect(result).toEqual(
        expect.objectContaining({
          error:
            "Your current plan (HOSTED_TRIAL) is limited to 1 workspace(s). Upgrade your plan to create more workspaces.",
        }),
      );
    });

    // The limit is the selling deployment's to apply. An install that bought no
    // plan resolves an unenforced entitlement and must not be capped — every
    // tenant carries HOSTED_TRIAL as its default plan code, so a compiled-in
    // trial limit held self-hosted installs to one workspace.
    it("applies no limit when no catalog claims one", async () => {
      getCommercialProfileSpy.mockResolvedValue({ planCode: "HOSTED_TRIAL" });
      countTenantWorkspacesSpy.mockResolvedValue(9);
      resolvePlanEntitlementsSpy.mockResolvedValue({
        displayName: "Hosted Trial",
        workspaces: { value: null, enforced: false },
        retainedEvents: { value: null, enforced: false },
        retentionWindowDays: { value: null, enforced: false },
        simulationEvents: { value: null, enforced: false },
      });
      insertWorkspaceSpy.mockResolvedValue({ id: "ws-new", slug: "my-ws" });

      const result = await service.createWorkspace({
        tenantId: "t1",
        principalId: "p1",
        workspaceName: "My Ws",
      });

      expect(result).toEqual(expect.objectContaining({ ok: true }));
    });

    it("requires admin permissions", async () => {
      findActorByIdSpy.mockResolvedValue({ reviewerRoles: ["Member"] });

      const result = await service.createWorkspace({
        tenantId: "t1",
        principalId: "p1",
        workspaceName: "My Ws",
      });

      expect(result).toEqual({ error: "Admin permission is required to create workspaces." });
      expect(insertAdminAuditEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "DENIED" }),
      );
    });
  });

  describe("deleteWorkspaceAdmin", () => {
    it("guards deleting active workspace", async () => {
      const result = await service.deleteWorkspaceAdmin({
        tenantId: "t1",
        workspaceId: "ws1",
        activeWorkspaceId: "ws1",
      });

      expect(result).toEqual({
        error: "Cannot delete the active workspace. Switch to another workspace first.",
      });
    });

    it("guards deleting the last workspace", async () => {
      countTenantWorkspacesSpy.mockResolvedValue(1);

      const result = await service.deleteWorkspaceAdmin({
        tenantId: "t1",
        workspaceId: "ws1",
        activeWorkspaceId: "ws2",
      });

      expect(result).toEqual({ error: "Cannot delete the last workspace." });
    });
  });

  describe("createWorkspace, beyond the plan limit", () => {
    it("refuses a demo tenant before creating anything", async () => {
      verifyWriteAccessSpy.mockReturnValue({ allowed: false, error: "Read-only in Demo Mode." });

      const result = await service.createWorkspace({
        tenantId: "t1",
        principalId: "p1",
        workspaceName: "My Ws",
      });

      expect(result).toEqual({ error: "Read-only in Demo Mode." });
      expect(insertWorkspaceSpy).not.toHaveBeenCalled();
    });

    it.each([
      ["   ", "Workspace name is required."],
      ["!!!", "Workspace name must include letters or numbers."],
    ])("refuses the name %j", async (workspaceName, error) => {
      const result = await service.createWorkspace({
        tenantId: "t1",
        principalId: "p1",
        workspaceName,
      });

      expect(result).toEqual({ error });
      expect(insertWorkspaceSpy).not.toHaveBeenCalled();
    });

    it("suffixes the slug past every one already taken", async () => {
      // Slugs are derived from the name, so two workspaces called the same
      // thing collide. The suffix has to clear the whole existing set, not just
      // the first match, or the insert fails on the unique constraint.
      listWorkspaceSlugsWithPrefixSpy.mockResolvedValue(["my-ws", "my-ws-2", "my-ws-3"]);
      insertWorkspaceSpy.mockResolvedValue(undefined);

      const result = await service.createWorkspace({
        tenantId: "t1",
        principalId: "p1",
        workspaceName: "My Ws",
      });

      expect(result).toEqual(expect.objectContaining({ ok: true, slug: "my-ws-4" }));
      expect(insertWorkspaceSpy).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "my-ws-4", name: "My Ws" }),
      );
    });

    it("seeds the default policy pack and records the creation", async () => {
      insertWorkspaceSpy.mockResolvedValue(undefined);

      const result = await service.createWorkspace({
        tenantId: "t1",
        principalId: "p1",
        workspaceName: "My Ws",
      });

      expect(result).toEqual(expect.objectContaining({ ok: true }));
      expect(ensureDefaultPublishedPolicyPackSpy).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "t1", actorId: "p1" }),
      );
      expect(insertAdminAuditEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: "workspace.create", outcome: "ALLOWED" }),
      );
    });
  });

  describe("switchTenant", () => {
    beforeEach(() => {
      getTenantPrincipalBySubjectSpy.mockResolvedValue({
        principal_id: "p-target",
        principal_subject: "user@example.com",
      });
      listWorkspacesForTenantSpy.mockResolvedValue([{ id: "ws-1", slug: "acme" }]);
      getTenantRequireMfaSpy.mockResolvedValue(false);
      updateSessionForTenantSwitchSpy.mockResolvedValue(undefined);
    });

    it("requires admin in the tenant being left, not the one being entered", async () => {
      findActorByIdSpy.mockResolvedValue({ reviewerRoles: ["Member"] });

      const result = await service.switchTenant({
        tenantId: "t-target",
        currentTenantId: "t-current",
        principalId: "p1",
        subject: "user@example.com",
        sessionId: "session-1",
      });

      expect(result).toEqual({ error: "Admin permission is required to switch tenants." });
      expect(findActorByIdSpy).toHaveBeenCalledWith("p1", { tenantId: "t-current" });
      expect(updateSessionForTenantSwitchSpy).not.toHaveBeenCalled();
      expect(insertAdminAuditEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: "tenant.switch", outcome: "DENIED" }),
      );
    });

    it("refuses a tenant the signed-in subject has no principal in", async () => {
      // The boundary that stops an admin of one tenant reaching another by id.
      getTenantPrincipalBySubjectSpy.mockResolvedValue(null);

      const result = await service.switchTenant({
        tenantId: "t-someone-elses",
        currentTenantId: "t-current",
        principalId: "p1",
        subject: "user@example.com",
        sessionId: "session-1",
      });

      expect(result).toEqual({ error: "Tenant is not available to the signed-in principal." });
      expect(updateSessionForTenantSwitchSpy).not.toHaveBeenCalled();
    });

    it("re-evaluates MFA against the tenant being entered", async () => {
      // MFA is a property of the target tenant. Carrying the current tenant's
      // answer across would let a switch into a stricter tenant skip it.
      getTenantRequireMfaSpy.mockResolvedValue(true);

      const result = await service.switchTenant({
        tenantId: "t-target",
        currentTenantId: "t-current",
        principalId: "p1",
        subject: "user@example.com",
        sessionId: "session-1",
      });

      expect(getTenantRequireMfaSpy).toHaveBeenCalledWith("t-target");
      expect(result).toEqual(expect.objectContaining({ ok: true, requiresMfa: true }));
      expect(updateSessionForTenantSwitchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-1",
          tenantId: "t-target",
          principalId: "p-target",
          requireMfa: true,
        }),
      );
    });

    it("rebinds the session to the target tenant's own principal", async () => {
      const result = await service.switchTenant({
        tenantId: "t-target",
        currentTenantId: "t-current",
        principalId: "p1",
        subject: "user@example.com",
        sessionId: "session-1",
      });

      expect(result).toEqual(
        expect.objectContaining({
          ok: true,
          targetPrincipalId: "p-target",
          firstWorkspaceId: "ws-1",
          firstWorkspaceSlug: "acme",
        }),
      );
    });

    it("touches no session when the caller has none", async () => {
      const result = await service.switchTenant({
        tenantId: "t-target",
        currentTenantId: "t-current",
        principalId: "p1",
        subject: "user@example.com",
        sessionId: undefined,
      });

      expect(result).toEqual(expect.objectContaining({ ok: true }));
      expect(updateSessionForTenantSwitchSpy).not.toHaveBeenCalled();
      expect(getTenantRequireMfaSpy).not.toHaveBeenCalled();
    });
  });

  describe("switchActor", () => {
    beforeEach(() => {
      getPrincipalSubjectSpy.mockResolvedValue("actor@example.com");
      updateSessionForActorSwitchSpy.mockResolvedValue(undefined);
    });

    it("requires admin outside the demo tenant", async () => {
      findActorByIdSpy.mockResolvedValue({ reviewerRoles: ["Member"] });

      const result = await service.switchActor({
        actorId: "a-2",
        currentPrincipalId: "p1",
        workspaceId: "ws-1",
        tenantId: "t-real",
        sessionId: "session-1",
      });

      expect(result).toEqual({ error: "Admin permission is required to switch active actor." });
      expect(insertAdminAuditEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: "actor.switch", outcome: "DENIED" }),
      );
    });

    it("lets the demo tenant switch actor without one", async () => {
      // Actor switching is how the demo tenant shows the reviewer personas, so
      // the admin check is deliberately skipped there and only there.
      findActorByIdSpy.mockResolvedValue({ id: "a-2", reviewerRoles: ["Security"] });

      const result = await service.switchActor({
        actorId: "a-2",
        currentPrincipalId: "p1",
        workspaceId: "ws-1",
        tenantId: "00000000-0000-0000-0000-000000000001",
        sessionId: "session-1",
      });

      expect(result).toEqual({ ok: true, actorSubject: "actor@example.com" });
    });

    it("refuses an actor that does not exist in this tenant and workspace", async () => {
      findActorByIdSpy
        .mockResolvedValueOnce({ reviewerRoles: ["Admin"] })
        .mockResolvedValueOnce(null);

      const result = await service.switchActor({
        actorId: "a-elsewhere",
        currentPrincipalId: "p1",
        workspaceId: "ws-1",
        tenantId: "t-real",
        sessionId: "session-1",
      });

      expect(result).toEqual({ error: "Actor is not available for this tenant/workspace." });
      expect(updateSessionForActorSwitchSpy).not.toHaveBeenCalled();
    });
  });

  describe("deleteWorkspaceAdmin, beyond the two guards", () => {
    beforeEach(() => {
      countTenantWorkspacesSpy.mockResolvedValue(3);
    });

    it("refuses a demo tenant", async () => {
      verifyWriteAccessSpy.mockReturnValue({ allowed: false, error: "Read-only in Demo Mode." });

      const result = await service.deleteWorkspaceAdmin({
        tenantId: "t1",
        workspaceId: "ws-2",
        activeWorkspaceId: "ws-1",
      });

      expect(result).toEqual({ error: "Read-only in Demo Mode." });
      expect(deleteWorkspaceByIdSpy).not.toHaveBeenCalled();
    });

    it("reports a workspace that was not there rather than a success", async () => {
      deleteWorkspaceByIdSpy.mockResolvedValue(null);

      const result = await service.deleteWorkspaceAdmin({
        tenantId: "t1",
        workspaceId: "ws-gone",
        activeWorkspaceId: "ws-1",
      });

      expect(result).toEqual({ error: "Workspace not found." });
    });

    it("hands back a workspace to fall back to", async () => {
      deleteWorkspaceByIdSpy.mockResolvedValue({ slug: "old-ws" });
      getFirstWorkspaceIdSpy.mockResolvedValue("ws-1");

      const result = await service.deleteWorkspaceAdmin({
        tenantId: "t1",
        workspaceId: "ws-2",
        activeWorkspaceId: "ws-1",
      });

      expect(result).toEqual(expect.objectContaining({ ok: true, fallbackWorkspaceId: "ws-1" }));
    });
  });
});
