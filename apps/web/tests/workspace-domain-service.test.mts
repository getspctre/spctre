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
vi.mock("@/lib/actors", () => ({
  findActorById: findActorByIdSpy,
}));
vi.mock("@/lib/demo-guard", () => ({
  verifyWriteAccess: verifyWriteAccessSpy,
}));
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

      expect(result).toEqual(expect.objectContaining({ error: "Your current plan (HOSTED_TRIAL) is limited to 1 workspace(s). Upgrade your plan to create more workspaces." }));
    });

    it("requires admin permissions", async () => {
      findActorByIdSpy.mockResolvedValue({ reviewerRoles: ["Member"] });

      const result = await service.createWorkspace({
        tenantId: "t1",
        principalId: "p1",
        workspaceName: "My Ws",
      });

      expect(result).toEqual({ error: "Admin permission is required to create workspaces." });
      expect(insertAdminAuditEventSpy).toHaveBeenCalledWith(expect.objectContaining({ outcome: "DENIED" }));
    });
  });

  describe("deleteWorkspaceAdmin", () => {
    it("guards deleting active workspace", async () => {
      const result = await service.deleteWorkspaceAdmin({
        tenantId: "t1",
        workspaceId: "ws1",
        activeWorkspaceId: "ws1",
      });

      expect(result).toEqual({ error: "Cannot delete the active workspace. Switch to another workspace first." });
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
});
