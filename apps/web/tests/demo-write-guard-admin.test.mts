import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthSessionSpy = vi.fn();
const getRequiredWorkspaceContextSpy = vi.fn();
const findActorByIdSpy = vi.fn();
const getActiveScopeSpy = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "session-123" }), set: () => {} }),
}));

vi.mock("@/lib/auth-session", () => ({ getAuthSession: getAuthSessionSpy }));

vi.mock("@/lib/workspace/server-context", () => ({
  getRequiredWorkspaceContext: getRequiredWorkspaceContextSpy,
}));

vi.mock("@/lib/repositories/shared/database", () => ({ isDatabaseConfigured: () => true }));

vi.mock("@/lib/actors", () => ({ findActorById: findActorByIdSpy }));

vi.mock("@/lib/workspace/scope", () => ({ getActiveScope: getActiveScopeSpy }));

vi.mock("@/lib/repositories/members", () => ({
  getActorOrgRole: async () => ({ org_role: "OWNER" }),
  getPrincipalBySubject: async () => null,
  getPrincipalOrgRole: async () => null,
  verifyWorkspaceAccess: async () => true,
  auditRbacAndLifecycle: async () => {},
  upsertPrincipalGrant: async () => {},
  upsertOrganizationInvite: async () => ({ id: "p-new", created: true }),
  updatePrincipalOrgRole: async () => {},
  deletePrincipalWorkspaceGrant: async () => {},
  revokeInvite: async () => {},
  removeOrganizationMember: async () => {},
}));

vi.mock("@/lib/repositories/mfa", () => ({ setTenantMfaPolicy: async () => {} }));

vi.mock("@/lib/repositories/identity-providers", () => ({
  upsertOidcIdentityProvider: async () => {},
  upsertSamlIdentityProvider: async () => {},
  deleteIdentityProviderById: async () => null,
  countIdentityProvidersByType: async () => 0,
  setTenantAuthFlag: async () => {},
}));

vi.mock("@/lib/service-tokens", () => ({
  ALL_API_KEY_SCOPES: ["read", "write"],
  issueServiceAccountKey: async () => ({
    rawToken: "raw-token",
    tokenId: "token-id",
    tokenPrefix: "spctre_",
  }),
}));

vi.mock("@/lib/repositories/operations-log", () => ({ appendOperationsLog: async () => {} }));

vi.mock("@/lib/repositories/approval-workflow", () => ({
  insertWorkflowAuditEvent: async () => {},
  deleteActiveApprovals: async () => 0,
  verifyWorkspaceForWorkflow: async () => true,
  getExistingWorkflowForScope: async () => null,
  getWorkflowRiskTags: async () => [],
  upsertWorkflowConfig: async () => "workflow-id",
  getNextWorkflowRuleSequence: async () => 1,
  upsertWorkflowRule: async () => {},
  getWorkflowForDisable: async () => ({ enabled: true, workspace_id: null, environment: null }),
  countEnabledWorkflows: async () => 2,
  disableWorkflowById: async () => null,
  getWorkflowScopeById: async () => null,
  deleteWorkflowRuleById: async () => {},
}));

vi.mock("@/lib/repositories/workspace", () => ({
  listWorkspaceSlugsWithPrefix: async () => [],
  insertWorkspace: async () => {},
  verifyWorkspaceOwnership: async () => true,
  checkSlugInUse: async () => false,
  updateWorkspaceDetails: async () => {},
  countTenantWorkspaces: async () => 2,
  deleteWorkspaceById: async () => ({ slug: "old-slug" }),
  getFirstWorkspaceId: async () => "w-fallback",
}));

const { createServiceKey } = await import("../app/admin/service-keys/actions");

const { upsertIdentityProvider } = await import("../app/admin/auth/idp-actions");

const { updateTenantMfaSettings } = await import("../app/admin/auth/mfa-actions");

const { inviteOrganizationMember } = await import("../app/admin/members/member-actions");

const { upsertApprovalWorkflow, disableApprovalWorkflow, removeApprovalWorkflowRule } =
  await import("../app/admin/workflows/workflow-actions");

function formData(values: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const entry of Array.isArray(value) ? value : [value]) data.append(key, entry);
  }
  return data;
}

describe("Demo Write Guard - Admin Routes", () => {
  const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";
  const REGULAR_TENANT = "regular-tenant-uuid";
  const FRIENDLY_ERROR =
    "This action is read-only in Demo Mode. Create a free Spctre Cloud account to save changes!";

  beforeEach(() => {
    vi.clearAllMocks();
    findActorByIdSpy.mockResolvedValue({
      id: "p-123",
      reviewerRoles: ["Admin", "Security", "Platform"],
    });
  });

  describe("Under DEMO_TENANT_ID", () => {
    beforeEach(() => {
      getAuthSessionSpy.mockResolvedValue({
        sessionId: "session-123",
        tenantId: DEMO_TENANT,
        principalId: "p-123",
        subject: "user@example.com",
        requireMfa: false,
      });
      getRequiredWorkspaceContextSpy.mockResolvedValue({
        tenantId: DEMO_TENANT,
        workspaceId: "w-123",
        workspaceSlug: "demo",
      });
      getActiveScopeSpy.mockResolvedValue({ tenantId: DEMO_TENANT, workspaceId: "w-123" });
    });

    const blockedActions = [
      [
        "service-keys -> createServiceKey",
        () => createServiceKey(null, formData({ label: "My Key", scopes: ["read"] })),
        { error: FRIENDLY_ERROR, errorCode: "write_denied" },
      ],
      [
        "auth -> upsertIdentityProvider",
        () =>
          upsertIdentityProvider(
            null,
            formData({
              name: "My IdP",
              issuer: "https://idp.example.com",
              providerType: "OIDC",
              clientId: "client-abc",
            }),
          ),
        { error: FRIENDLY_ERROR },
      ],
      [
        "auth -> updateTenantMfaSettings",
        () => updateTenantMfaSettings(null, formData({ requireMfa: "on", mfaGraceDays: "7" })),
        { error: FRIENDLY_ERROR },
      ],
      [
        "members -> inviteOrganizationMember",
        () =>
          inviteOrganizationMember(
            null,
            formData({ displayName: "Alice", email: "alice@example.com", orgRole: "REVIEWER" }),
          ),
        { error: FRIENDLY_ERROR },
      ],
      [
        "workflows -> upsertApprovalWorkflow",
        () =>
          upsertApprovalWorkflow(
            null,
            formData({
              name: "My Workflow",
              role: "Security",
              requiredCount: "1",
              eligibleRole: ["Security"],
            }),
          ),
        { error: FRIENDLY_ERROR },
      ],
      [
        "workflows -> disableApprovalWorkflow",
        () => disableApprovalWorkflow(null, formData({ workflowId: "wf-123" })),
        { error: FRIENDLY_ERROR },
      ],
      [
        "workflows -> removeApprovalWorkflowRule",
        () =>
          removeApprovalWorkflowRule(null, formData({ workflowId: "wf-123", ruleId: "rule-456" })),
        { error: FRIENDLY_ERROR },
      ],
    ] as const;

    it.each(blockedActions)("blocks %s", async (_name, invoke, expected) => {
      await expect(invoke()).resolves.toEqual(expected);
    });
  });

  describe("Under standard REGULAR_TENANT", () => {
    beforeEach(() => {
      getAuthSessionSpy.mockResolvedValue({
        sessionId: "session-123",
        tenantId: REGULAR_TENANT,
        principalId: "p-123",
        subject: "user@example.com",
        requireMfa: false,
      });
      getRequiredWorkspaceContextSpy.mockResolvedValue({
        tenantId: REGULAR_TENANT,
        workspaceId: "w-123",
        workspaceSlug: "regular",
      });
      getActiveScopeSpy.mockResolvedValue({ tenantId: REGULAR_TENANT, workspaceId: "w-123" });
    });

    it("allows service-keys -> createServiceKey (passes demo guard)", async () => {
      const result = await createServiceKey(null, new FormData());
      expect(result).not.toEqual({ error: FRIENDLY_ERROR });
      expect(result?.error).not.toBe(FRIENDLY_ERROR);
    });

    it("allows auth -> upsertIdentityProvider (passes demo guard)", async () => {
      const result = await upsertIdentityProvider(null, new FormData());
      expect(result).not.toEqual({ error: FRIENDLY_ERROR });
    });

    it("allows auth -> updateTenantMfaSettings (passes demo guard)", async () => {
      const formData = new FormData();
      formData.set("requireMfa", "on");
      formData.set("mfaGraceDays", "7");
      const result = await updateTenantMfaSettings(null, formData);
      expect(result).not.toEqual({ error: FRIENDLY_ERROR });
      expect(result).toEqual({ ok: true, messageCode: "updated" });
    });

    it("allows members -> inviteOrganizationMember (passes demo guard)", async () => {
      const result = await inviteOrganizationMember(null, new FormData());
      expect(result).not.toEqual({ error: FRIENDLY_ERROR });
    });

    it("allows workflows -> upsertApprovalWorkflow (passes demo guard)", async () => {
      const result = await upsertApprovalWorkflow(null, new FormData());
      expect(result).not.toEqual({ error: FRIENDLY_ERROR });
    });

    it("allows workflows -> disableApprovalWorkflow (passes demo guard)", async () => {
      const result = await disableApprovalWorkflow(null, new FormData());
      expect(result).not.toEqual({ error: FRIENDLY_ERROR });
    });

    it("allows workflows -> removeApprovalWorkflowRule (passes demo guard)", async () => {
      const result = await removeApprovalWorkflowRule(null, new FormData());
      expect(result).not.toEqual({ error: FRIENDLY_ERROR });
    });
  });
});
