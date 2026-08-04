import { describe, expect, it } from "vitest";
import { ORG_ROLES, ROLE_DEFINITIONS, inferRoleFromGrant, roleDefinition } from "../lib/rbac";
import { grantForRole, normalizeOrgRole } from "../lib/repositories/members";

describe("organization RBAC role matrix", () => {
  it("defines the five built-in organization roles", () => {
    expect(ORG_ROLES).toEqual(["OWNER", "ADMIN", "REVIEWER", "CONTRIBUTOR", "VIEWER"]);
    expect(ROLE_DEFINITIONS.OWNER.capabilities).toContain("Manage billing");
    expect(ROLE_DEFINITIONS.ADMIN.reviewerRoles).toContain("Admin");
    expect(ROLE_DEFINITIONS.VIEWER.publishScopes).toEqual([]);
  });

  it("maps roles to existing reviewer and publish grants", () => {
    expect(grantForRole("OWNER")).toMatchObject({
      reviewerRoles: expect.arrayContaining(["Admin", "Security", "Platform"]),
      publishScopes: expect.arrayContaining(["ORGANIZATION", "WORKSPACE", "CONNECTOR"]),
    });
    expect(grantForRole("CONTRIBUTOR")).toMatchObject({
      reviewerRoles: [],
      publishScopes: [],
      allowedEnvironments: ["development", "staging"],
    });
  });

  it("normalizes unknown roles and infers legacy grants", () => {
    expect(normalizeOrgRole("NOPE")).toBe("VIEWER");
    expect(roleDefinition("NOPE").role).toBe("VIEWER");
    expect(inferRoleFromGrant({ reviewerRoles: ["Admin"], publishScopes: [] })).toBe("ADMIN");
    expect(inferRoleFromGrant({ reviewerRoles: ["Security"], publishScopes: [] })).toBe("REVIEWER");
    expect(inferRoleFromGrant({ reviewerRoles: [], publishScopes: ["WORKSPACE"] })).toBe(
      "CONTRIBUTOR",
    );
  });
});
