import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_ROLES, type OrgRole } from "../lib/rbac";

// The organization role ladder, which is the privilege boundary of the members
// surface: nobody may grant a role above their own, or modify a member who
// already holds one. Both halves are enforced in the domain, both are a single
// `canGrantRole` call, and neither is visible from the outside when it breaks —
// a wrong answer here reads as a successful action.
//
// The ladder is `rank(target) >= rank(actor)` over OWNER(0) → VIEWER(4), so an
// actor may grant their own role and anything less privileged. These tests walk
// every ordered pair rather than sampling, because the failure that matters is
// one pair being wrong, not the rule being absent.

const getActorOrgRoleSpy = vi.fn();
const getPrincipalBySubjectSpy = vi.fn();
const getPrincipalOrgRoleSpy = vi.fn();
const verifyWorkspaceAccessSpy = vi.fn();
const auditRbacAndLifecycleSpy = vi.fn();
const upsertPrincipalGrantSpy = vi.fn();
const upsertOrganizationInviteSpy = vi.fn();
const updatePrincipalOrgRoleSpy = vi.fn();
const deletePrincipalWorkspaceGrantSpy = vi.fn();
const revokeInviteSpy = vi.fn();
const removeOrganizationMemberSpy = vi.fn();
const requireAdminActorSpy = vi.fn();
const checkWriteAccessSpy = vi.fn();
const sendMemberInviteEmailSpy = vi.fn();

vi.mock("@/lib/repositories/members", () => ({
  listOrganizationMembers: vi.fn(),
  listRecentRbacAuditEvents: vi.fn(),
  listTenantWorkspaces: vi.fn(),
  getActorOrgRole: getActorOrgRoleSpy,
  getPrincipalBySubject: getPrincipalBySubjectSpy,
  getPrincipalOrgRole: getPrincipalOrgRoleSpy,
  verifyWorkspaceAccess: verifyWorkspaceAccessSpy,
  auditRbacAndLifecycle: auditRbacAndLifecycleSpy,
  upsertPrincipalGrant: upsertPrincipalGrantSpy,
  upsertOrganizationInvite: upsertOrganizationInviteSpy,
  updatePrincipalOrgRole: updatePrincipalOrgRoleSpy,
  deletePrincipalWorkspaceGrant: deletePrincipalWorkspaceGrantSpy,
  revokeInvite: revokeInviteSpy,
  removeOrganizationMember: removeOrganizationMemberSpy,
}));

vi.mock("@/lib/domains/shared/guard", () => ({
  requireAdminActor: requireAdminActorSpy,
  checkWriteAccess: checkWriteAccessSpy,
}));

vi.mock("@/lib/email", () => ({ sendMemberInviteEmail: sendMemberInviteEmailSpy }));
vi.mock("@/lib/workspace", () => ({ getWorkspaceContext: vi.fn() }));
vi.mock("@/lib/auth-session", () => ({ getAuthSession: vi.fn() }));
vi.mock("@/lib/actors", () => ({ findActorById: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenantContext: (_tenantId: string, fn: () => unknown) => fn(),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const service = await import("../lib/domains/members/service");

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "principal-actor";
const TARGET = "principal-target";
const WORKSPACE = "workspace-1";

/** Ranked most privileged first, matching ROLE_RANK. */
const LADDER: OrgRole[] = ["OWNER", "ADMIN", "REVIEWER", "CONTRIBUTOR", "VIEWER"];

/** The rule under test, restated independently of the implementation. */
function shouldAllow(actor: OrgRole, target: OrgRole): boolean {
  return LADDER.indexOf(target) >= LADDER.indexOf(actor);
}

/** Signs the caller in as an admin holding `actorOrgRole`. */
function actingAs(actorOrgRole: OrgRole) {
  requireAdminActorSpy.mockResolvedValue({
    session: { tenantId: TENANT, principalId: ACTOR },
    workspaceId: WORKSPACE,
  });
  getActorOrgRoleSpy.mockResolvedValue(actorOrgRole);
}

/** The member being acted on already holds `orgRole`. */
function targetHolds(orgRole: OrgRole | null) {
  getPrincipalOrgRoleSpy.mockResolvedValue(orgRole ? { org_role: orgRole } : null);
  getPrincipalBySubjectSpy.mockResolvedValue(orgRole ? { org_role: orgRole } : null);
}

beforeEach(() => {
  vi.clearAllMocks();
  checkWriteAccessSpy.mockReturnValue({ allowed: true });
  verifyWorkspaceAccessSpy.mockResolvedValue(true);
  upsertOrganizationInviteSpy.mockResolvedValue({ id: TARGET });
  getPrincipalBySubjectSpy.mockResolvedValue(null);
  sendMemberInviteEmailSpy.mockResolvedValue(undefined);
});

describe("the role ladder is complete", () => {
  it("covers every ordered pair of organization roles", () => {
    // Guards the table below: a new role added to ORG_ROLES without a rank
    // would otherwise be silently untested.
    expect([...ORG_ROLES].sort()).toEqual([...LADDER].sort());
  });
});

describe("inviting a member", () => {
  for (const actorRole of LADDER) {
    for (const targetRole of LADDER) {
      const allowed = shouldAllow(actorRole, targetRole);
      it(`${allowed ? "lets" : "refuses"} ${actorRole} invite at ${targetRole}`, async () => {
        actingAs(actorRole);

        const result = await service.inviteOrganizationMemberDecision({
          displayName: "New Member",
          email: "new.member@example.com",
          orgRole: targetRole,
        });

        if (allowed) {
          expect(result).toMatchObject({ ok: true });
          expect(upsertOrganizationInviteSpy).toHaveBeenCalledWith(
            expect.objectContaining({ orgRole: targetRole, tenantId: TENANT }),
          );
        } else {
          expect(result).toEqual({ error: "You cannot assign a role higher than your own." });
          expect(upsertOrganizationInviteSpy).not.toHaveBeenCalled();
          expect(upsertPrincipalGrantSpy).not.toHaveBeenCalled();
        }
      });
    }
  }

  it("refuses to re-invite an existing member who outranks the actor", async () => {
    // A second, separate check: the requested role is grantable, but the person
    // already holds something higher. Losing this branch lets an ADMIN rewrite
    // an OWNER by inviting them again at a lower role.
    actingAs("ADMIN");
    targetHolds("OWNER");

    const result = await service.inviteOrganizationMemberDecision({
      displayName: "Existing Owner",
      email: "owner@example.com",
      orgRole: "VIEWER",
    });

    expect(result).toEqual({
      error: "You cannot modify a member with a higher role than your own.",
    });
    expect(upsertOrganizationInviteSpy).not.toHaveBeenCalled();
  });

  it("normalizes the address it matches and stores", async () => {
    actingAs("OWNER");

    await service.inviteOrganizationMemberDecision({
      displayName: "Mixed Case",
      email: "  Mixed.Case@Example.COM  ",
      orgRole: "REVIEWER",
    });

    expect(getPrincipalBySubjectSpy).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "mixed.case@example.com" }),
    );
  });

  it.each([
    ["", "valid@example.com", "REVIEWER", "Display name is required."],
    ["Name", "not-an-address", "REVIEWER", "A valid email address is required."],
    ["Name", "spaces in@example.com", "REVIEWER", "A valid email address is required."],
    ["Name", "valid@example.com", null, "Select a built-in organization role."],
  ])("rejects (%s, %s, %s)", async (displayName, email, orgRole, error) => {
    actingAs("OWNER");

    const result = await service.inviteOrganizationMemberDecision({
      displayName,
      email,
      orgRole: orgRole as OrgRole | null,
    });

    expect(result).toEqual({ error });
    expect(upsertOrganizationInviteSpy).not.toHaveBeenCalled();
  });

  it("refuses before any check when the caller is not an admin", async () => {
    requireAdminActorSpy.mockResolvedValue({ error: "Admin permission is required." });

    const result = await service.inviteOrganizationMemberDecision({
      displayName: "Name",
      email: "valid@example.com",
      orgRole: "VIEWER",
    });

    expect(result).toEqual({ error: "Admin permission is required." });
    expect(getActorOrgRoleSpy).not.toHaveBeenCalled();
  });

  it("refuses a demo tenant even for an owner", async () => {
    actingAs("OWNER");
    checkWriteAccessSpy.mockReturnValue({ error: "Read-only in Demo Mode." });

    const result = await service.inviteOrganizationMemberDecision({
      displayName: "Name",
      email: "valid@example.com",
      orgRole: "VIEWER",
    });

    expect(result).toEqual({ error: "Read-only in Demo Mode." });
    expect(upsertOrganizationInviteSpy).not.toHaveBeenCalled();
  });
});

describe("changing a member's organization role", () => {
  for (const actorRole of LADDER) {
    for (const targetRole of LADDER) {
      const allowed = shouldAllow(actorRole, targetRole);
      it(`${allowed ? "lets" : "refuses"} ${actorRole} set a VIEWER to ${targetRole}`, async () => {
        actingAs(actorRole);
        targetHolds("VIEWER");

        const result = await service.updateMemberOrgRoleDecision({
          principalId: TARGET,
          orgRole: targetRole,
        });

        if (allowed) {
          expect(result).toEqual({ ok: true });
          expect(updatePrincipalOrgRoleSpy).toHaveBeenCalledWith(
            expect.objectContaining({ principalId: TARGET, orgRole: targetRole }),
          );
        } else {
          expect(result).toEqual({ error: "You cannot grant this role." });
          expect(updatePrincipalOrgRoleSpy).not.toHaveBeenCalled();
        }
      });
    }
  }

  it("refuses to demote a member who outranks the actor", async () => {
    // The role being granted is allowed; the member's current role is not. This
    // is the branch that stops an ADMIN from demoting an OWNER.
    actingAs("ADMIN");
    targetHolds("OWNER");

    const result = await service.updateMemberOrgRoleDecision({
      principalId: TARGET,
      orgRole: "VIEWER",
    });

    expect(result).toEqual({ error: "Insufficient privileges to modify this member." });
    expect(updatePrincipalOrgRoleSpy).not.toHaveBeenCalled();
  });

  it("reports a member that does not exist rather than writing one", async () => {
    actingAs("OWNER");
    targetHolds(null);

    const result = await service.updateMemberOrgRoleDecision({
      principalId: TARGET,
      orgRole: "VIEWER",
    });

    expect(result).toEqual({ error: "Member not found." });
    expect(updatePrincipalOrgRoleSpy).not.toHaveBeenCalled();
  });

  it("records the change in the audit trail", async () => {
    actingAs("OWNER");
    targetHolds("VIEWER");

    await service.updateMemberOrgRoleDecision({ principalId: TARGET, orgRole: "ADMIN" });

    expect(auditRbacAndLifecycleSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "MEMBER_ROLE_UPDATED",
        actorId: ACTOR,
        targetPrincipalId: TARGET,
        detail: { orgRole: "ADMIN" },
      }),
    );
  });
});

describe("workspace role overrides", () => {
  it("refuses an override on a member who outranks the actor", async () => {
    actingAs("ADMIN");
    targetHolds("OWNER");

    const result = await service.updateWorkspaceOverrideDecision({
      principalId: TARGET,
      workspaceId: WORKSPACE,
      roleRaw: "VIEWER",
    });

    expect(result).toEqual({ error: "Insufficient privileges to modify this member." });
    expect(upsertPrincipalGrantSpy).not.toHaveBeenCalled();
  });

  it("refuses an override at a role the actor could not grant organization-wide", async () => {
    actingAs("ADMIN");
    targetHolds("REVIEWER");

    const result = await service.updateWorkspaceOverrideDecision({
      principalId: TARGET,
      workspaceId: WORKSPACE,
      roleRaw: "OWNER",
    });

    expect(result).toEqual({ error: "Select a workspace role you are allowed to grant." });
    expect(upsertPrincipalGrantSpy).not.toHaveBeenCalled();
  });

  it("rejects a role string that is not an organization role", async () => {
    actingAs("OWNER");
    targetHolds("VIEWER");

    const result = await service.updateWorkspaceOverrideDecision({
      principalId: TARGET,
      workspaceId: WORKSPACE,
      roleRaw: "SUPERUSER",
    });

    expect(result).toEqual({ error: "Select a workspace role you are allowed to grant." });
    expect(upsertPrincipalGrantSpy).not.toHaveBeenCalled();
  });

  it("removes the override on INHERIT rather than writing one", async () => {
    actingAs("OWNER");
    targetHolds("REVIEWER");

    const result = await service.updateWorkspaceOverrideDecision({
      principalId: TARGET,
      workspaceId: WORKSPACE,
      roleRaw: "INHERIT",
    });

    expect(result).toEqual({ ok: true });
    expect(deletePrincipalWorkspaceGrantSpy).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: TARGET, workspaceId: WORKSPACE }),
    );
    expect(upsertPrincipalGrantSpy).not.toHaveBeenCalled();
    expect(auditRbacAndLifecycleSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: "WORKSPACE_OVERRIDE_REMOVED" }),
    );
  });

  it("refuses a workspace the tenant cannot reach", async () => {
    // Guards against acting on another tenant's workspace by id.
    actingAs("OWNER");
    verifyWorkspaceAccessSpy.mockResolvedValue(false);

    const result = await service.updateWorkspaceOverrideDecision({
      principalId: TARGET,
      workspaceId: "workspace-elsewhere",
      roleRaw: "VIEWER",
    });

    expect(result).toEqual({ error: "Workspace is not available." });
    expect(getPrincipalOrgRoleSpy).not.toHaveBeenCalled();
  });

  it("requires both a member and a workspace", async () => {
    actingAs("OWNER");

    const result = await service.updateWorkspaceOverrideDecision({
      principalId: "",
      workspaceId: WORKSPACE,
      roleRaw: "VIEWER",
    });

    expect(result).toEqual({ error: "Member and workspace are required." });
    expect(verifyWorkspaceAccessSpy).not.toHaveBeenCalled();
  });
});

describe("removing a member", () => {
  it("refuses to remove the acting principal", async () => {
    // Self-removal from this screen would strip the last admin of a tenant with
    // no way back in.
    actingAs("OWNER");

    const result = await service.removeOrganizationMemberDecision({ principalId: ACTOR });

    expect(result).toEqual({ error: "You cannot remove your own membership from this screen." });
    expect(removeOrganizationMemberSpy).not.toHaveBeenCalled();
  });

  it("removes another member and records it", async () => {
    actingAs("OWNER");

    const result = await service.removeOrganizationMemberDecision({ principalId: TARGET });

    expect(result).toEqual({ ok: true });
    expect(removeOrganizationMemberSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, principalId: TARGET }),
    );
    expect(auditRbacAndLifecycleSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: "MEMBER_REMOVED", targetPrincipalId: TARGET }),
    );
  });

  it("refuses a demo tenant", async () => {
    actingAs("OWNER");
    checkWriteAccessSpy.mockReturnValue({ error: "Read-only in Demo Mode." });

    const result = await service.removeOrganizationMemberDecision({ principalId: TARGET });

    expect(result).toEqual({ error: "Read-only in Demo Mode." });
    expect(removeOrganizationMemberSpy).not.toHaveBeenCalled();
  });
});

describe("revoking an invite", () => {
  it("revokes and records it", async () => {
    actingAs("ADMIN");

    const result = await service.revokeMemberInviteDecision({ principalId: TARGET });

    expect(result).toEqual({ ok: true });
    expect(revokeInviteSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, principalId: TARGET }),
    );
    expect(auditRbacAndLifecycleSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: "INVITE_REVOKED" }),
    );
  });

  it("requires a member", async () => {
    actingAs("ADMIN");

    const result = await service.revokeMemberInviteDecision({ principalId: "" });

    expect(result).toEqual({ error: "Member is missing." });
    expect(revokeInviteSpy).not.toHaveBeenCalled();
  });
});
