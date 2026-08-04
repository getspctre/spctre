import type { PolicyBranch } from "@spctre/policy-schema";

export const ORG_ROLES = ["OWNER", "ADMIN", "REVIEWER", "CONTRIBUTOR", "VIEWER"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const REVIEWER_ROLES = ["Security", "Platform", "Legal", "Ops", "Admin"] as const;
const DEFAULT_ENVIRONMENTS = ["development", "staging", "production", "incident-mode"] as const;

export interface RoleDefinition {
  role: OrgRole;
  label: string;
  summary: string;
  reviewerRoles: string[];
  publishScopes: PolicyBranch["scope"][];
  allowedEnvironments: string[];
  capabilities: string[];
}

export const ROLE_DEFINITIONS: Record<OrgRole, RoleDefinition> = {
  OWNER: {
    role: "OWNER",
    label: "Owner",
    summary:
      "Full tenant control, billing, workspace administration, review, and publish authority.",
    reviewerRoles: ["Admin", "Security", "Platform", "Legal", "Ops"],
    publishScopes: ["ORGANIZATION", "WORKSPACE", "COMPANY", "ENVIRONMENT", "CONNECTOR"],
    allowedEnvironments: [...DEFAULT_ENVIRONMENTS],
    capabilities: [
      "Manage billing",
      "Manage members",
      "Approve policies",
      "Publish bundles",
      "Export compliance",
    ],
  },
  ADMIN: {
    role: "ADMIN",
    label: "Admin",
    summary: "Member, workspace, and governance operations without billing ownership.",
    reviewerRoles: ["Admin", "Ops"],
    publishScopes: ["WORKSPACE", "COMPANY", "ENVIRONMENT", "CONNECTOR"],
    allowedEnvironments: [...DEFAULT_ENVIRONMENTS],
    capabilities: [
      "Manage members",
      "Manage workspaces",
      "Publish workspace bundles",
      "Resolve operations",
    ],
  },
  REVIEWER: {
    role: "REVIEWER",
    label: "Reviewer",
    summary: "Review and approve policy bundles across security, platform, legal, and ops lanes.",
    reviewerRoles: ["Security", "Platform", "Legal", "Ops"],
    publishScopes: [],
    allowedEnvironments: [...DEFAULT_ENVIRONMENTS],
    capabilities: ["Approve policies", "Request changes", "Inspect evidence", "Export compliance"],
  },
  CONTRIBUTOR: {
    role: "CONTRIBUTOR",
    label: "Contributor",
    summary: "Author policy changes and submit them for review without approval authority.",
    reviewerRoles: [],
    publishScopes: [],
    allowedEnvironments: ["development", "staging"],
    capabilities: ["Author rules", "Import packs", "Run simulations", "Submit for review"],
  },
  VIEWER: {
    role: "VIEWER",
    label: "Viewer",
    summary: "Read-only access to policy, evidence, compliance, and operations surfaces.",
    reviewerRoles: [],
    publishScopes: [],
    allowedEnvironments: [],
    capabilities: ["View policies", "View evidence", "View compliance", "View operations"],
  },
};

export function isOrgRole(value: string): value is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(value);
}

const ROLE_RANK: Record<OrgRole, number> = {
  OWNER: 0,
  ADMIN: 1,
  REVIEWER: 2,
  CONTRIBUTOR: 3,
  VIEWER: 4,
};

export function canGrantRole(actorRole: OrgRole, targetRole: OrgRole): boolean {
  return ROLE_RANK[targetRole] >= ROLE_RANK[actorRole];
}

export function roleDefinition(role: string | null | undefined): RoleDefinition {
  return ROLE_DEFINITIONS[isOrgRole(role ?? "") ? (role as OrgRole) : "VIEWER"];
}

export function inferRoleFromGrant(params: {
  grantRole?: string | null;
  reviewerRoles?: string[] | null;
  publishScopes?: string[] | null;
}): OrgRole {
  if (params.grantRole && isOrgRole(params.grantRole)) return params.grantRole;
  const reviewerRoles = params.reviewerRoles ?? [];
  const publishScopes = params.publishScopes ?? [];
  if (reviewerRoles.includes("Admin")) return "ADMIN";
  if (reviewerRoles.length > 0) return "REVIEWER";
  if (publishScopes.length > 0) return "CONTRIBUTOR";
  return "VIEWER";
}
