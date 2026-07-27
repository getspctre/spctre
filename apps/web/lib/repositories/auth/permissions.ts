import type { PolicyBranch } from "@spctre/policy-schema";
import { sql } from "@/lib/db";

export interface Principal {
  id: string;
  name: string;
  email: string | null;
  reviewerRoles: string[];
  publishScopes: PolicyBranch["scope"][];
  allowedEnvironments: "ALL" | string[];
  allowedWorkspaceSlugs: "ALL" | string[];
}

export async function loadPersistedActorsFromDatabase(
  targetWorkspaceId: string,
  targetTenantId: string
): Promise<Principal[]> {
  if (!sql) return [];

  const principalRows = await sql<
    {
      id: string;
      display_name: string;
      email: string | null;
      reviewer_roles: string[];
      publish_scopes: string[];
      allowed_environments: string[];
      workspace_id: string | null;
      workspace_slug: string | null;
    }[]
  >`
    SELECT
      p.id,
      p.display_name,
      p.email,
      g.reviewer_roles,
      g.publish_scopes,
      g.allowed_environments,
      g.workspace_id,
      w.slug AS workspace_slug
    FROM app_principal p
    JOIN principal_permission_grant g ON g.principal_id = p.id
    LEFT JOIN workspace w ON w.id = g.workspace_id
    WHERE p.tenant_id = ${targetTenantId}
      AND g.tenant_id = ${targetTenantId}
      AND (g.workspace_id IS NULL OR g.workspace_id = ${targetWorkspaceId})
    ORDER BY p.created_at ASC
  `;

  if (!principalRows.length) return [];

  const byPrincipalId = new Map<string, Principal>();

  for (const row of principalRows) {
    const existing = byPrincipalId.get(row.id);
    const reviewerRoles = row.reviewer_roles ?? [];
    const publishScopes = row.publish_scopes as PolicyBranch["scope"][];
    const envs = row.allowed_environments ?? [];
    const workspaceScopes = row.workspace_id ? [row.workspace_slug ?? "workspace-demo"] : [];

    if (!existing) {
      byPrincipalId.set(row.id, {
        id: row.id,
        name: row.display_name,
        email: row.email ?? null,
        reviewerRoles,
        publishScopes,
        allowedEnvironments: envs.length ? envs : "ALL",
        allowedWorkspaceSlugs: workspaceScopes.length ? workspaceScopes : "ALL"
      });
      continue;
    }

    existing.reviewerRoles = Array.from(new Set([...existing.reviewerRoles, ...reviewerRoles]));
    existing.publishScopes = Array.from(
      new Set([...existing.publishScopes, ...publishScopes])
    ) as PolicyBranch["scope"][];
    if (existing.allowedEnvironments !== "ALL") {
      existing.allowedEnvironments = Array.from(new Set([...existing.allowedEnvironments, ...envs]));
    }
    if (existing.allowedWorkspaceSlugs !== "ALL" && workspaceScopes.length) {
      existing.allowedWorkspaceSlugs = Array.from(
        new Set([...existing.allowedWorkspaceSlugs, ...workspaceScopes])
      );
    }
  }

  return Array.from(byPrincipalId.values());
}
