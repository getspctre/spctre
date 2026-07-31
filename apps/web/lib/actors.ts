import { cache } from "react";
import { cookies } from "next/headers";
import type { PolicyBranch } from "@spctre/policy-schema";
import { getAuthSession } from "./auth-session";
import { DEMO_TENANT_ID, DEMO_WORKSPACE_ID } from "./demo";
import {
  loadPersistedActorsFromDatabase,
  type Principal
} from "./repositories/auth/permissions";
import { isDatabaseConfigured } from "./repositories/shared/database";
import { swallow } from "@/lib/platform/swallow";

const ACTIVE_ACTOR_COOKIE = "spctre_actor_id";

export type { Principal };

export interface BranchPermissionSnapshot {
  canPublish: boolean;
  publishReason?: string;
  reviewableRoles: string[];
  reviewBlockedReason?: string;
}

const SEED_PRINCIPALS: Principal[] = [
  {
    id: "maya-security",
    name: "Maya Security",
    email: null,
    reviewerRoles: ["Security", "Legal"],
    publishScopes: ["ORGANIZATION", "WORKSPACE", "ENVIRONMENT", "CONNECTOR"],
    allowedEnvironments: "ALL",
    allowedWorkspaceSlugs: "ALL"
  },
  {
    id: "lee-platform",
    name: "Lee Platform",
    email: null,
    reviewerRoles: ["Platform", "Ops"],
    publishScopes: ["WORKSPACE", "ENVIRONMENT", "CONNECTOR"],
    allowedEnvironments: ["development", "staging", "incident-mode"],
    allowedWorkspaceSlugs: "ALL"
  },
  {
    id: "nora-workspace-owner",
    name: "Nora Workspace Owner",
    email: null,
    reviewerRoles: ["Ops", "Admin"],
    publishScopes: ["WORKSPACE", "CONNECTOR"],
    allowedEnvironments: ["development", "staging"],
    allowedWorkspaceSlugs: ["workspace-demo"]
  }
];

export function buildActorEmailFormatter(actors: Principal[]): (id: string) => string {
  const map = new Map(actors.map((a) => [a.id, a.email]));
  return (id: string) => map.get(id) ?? id;
}

const _loadPersistedActorsImpl = cache(async function(
  targetWorkspaceId: string,
  targetTenantId: string
): Promise<Principal[]> {
  return loadPersistedActorsFromDatabase(targetWorkspaceId, targetTenantId);
});

function loadPersistedActors(options?: {
  workspaceId?: string;
  tenantId?: string;
}): Promise<Principal[]> {
  return _loadPersistedActorsImpl(
    options?.workspaceId ?? DEMO_WORKSPACE_ID,
    options?.tenantId ?? DEMO_TENANT_ID
  );
}

export async function getActiveActor(options?: { workspaceId?: string; tenantId?: string }) {
  const persisted = await loadPersistedActors(options).catch(swallow("loadPersistedActors", []));
  const actors = persisted.length ? persisted : SEED_PRINCIPALS;

  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  if (isDatabaseConfigured() && !session) {
    throw new Error("Authentication required.");
  }

  if (session?.principalId) {
    const sessionActor = actors.find((candidate) => candidate.id === session.principalId);
    if (sessionActor) {
      return {
        actor: sessionActor,
        actors
      };
    }

    if (isDatabaseConfigured()) {
      throw new Error("No permission grants are configured for the authenticated principal.");
    }
  }

  // Cookie-based actor selection is only used in no-DB demo mode. When a real DB
  // is present, actor identity comes exclusively from the session to prevent spoofing.
  const cookieStore = await cookies();
  const fallbackActorId = isDatabaseConfigured() ? null : cookieStore.get(ACTIVE_ACTOR_COOKIE)?.value;
  const actor = actors.find((candidate) => candidate.id === fallbackActorId) ?? actors[0];

  return {
    actor,
    actors
  };
}

export async function findActorById(
  actorId: string,
  options?: { workspaceId?: string; tenantId?: string }
): Promise<Principal | null> {
  const actors = (await loadPersistedActors(options).catch(swallow("loadPersistedActors", []))) || [];
  const source = actors.length ? actors : SEED_PRINCIPALS;
  return source.find((candidate) => candidate.id === actorId) ?? null;
}

export function requireActorAdminWorkspace(
  actor: Principal,
  workspaceSlug: string
): { allowed: true } | { allowed: false; reason: string } {
  const workspaceAllowed =
    actor.allowedWorkspaceSlugs === "ALL" || actor.allowedWorkspaceSlugs.includes(workspaceSlug);

  if (!workspaceAllowed) {
    return {
      allowed: false,
      reason: `Actor ${actor.name} is not assigned to ${workspaceSlug}.`
    };
  }

  if (!actor.reviewerRoles.includes("Admin")) {
    return {
      allowed: false,
      reason: `Actor ${actor.name} does not have admin permission for ${workspaceSlug}.`
    };
  }

  return { allowed: true };
}

export function getBranchPermissions(params: {
  actor: Principal;
  branch: Pick<PolicyBranch, "scope" | "environment">;
  workspaceSlug: string;
}): BranchPermissionSnapshot {
  const { actor, branch, workspaceSlug } = params;
  const workspaceAllowed =
    actor.allowedWorkspaceSlugs === "ALL" || actor.allowedWorkspaceSlugs.includes(workspaceSlug);
  const environmentAllowed =
    actor.allowedEnvironments === "ALL" ||
    !branch.environment ||
    actor.allowedEnvironments.includes(branch.environment);
  const canPublish =
    workspaceAllowed && environmentAllowed && actor.publishScopes.includes(branch.scope);

  let publishReason: string | undefined;
  if (!workspaceAllowed) {
    publishReason = `Actor ${actor.name} is not assigned to ${workspaceSlug}.`;
  } else if (!actor.publishScopes.includes(branch.scope)) {
    publishReason = `Actor ${actor.name} cannot publish ${branch.scope.toLowerCase()} branches.`;
  } else if (!environmentAllowed) {
    publishReason = `Actor ${actor.name} cannot publish ${branch.environment ?? "this environment"}.`;
  }

  return {
    canPublish,
    publishReason,
    reviewableRoles: actor.reviewerRoles,
    reviewBlockedReason: workspaceAllowed
      ? undefined
      : `Actor ${actor.name} cannot review changes in ${workspaceSlug}.`
  };
}

export function canActorReviewRole(
  actor: Principal,
  workspaceSlug: string,
  role: string
): { allowed: boolean; reason?: string } {
  const workspaceAllowed =
    actor.allowedWorkspaceSlugs === "ALL" || actor.allowedWorkspaceSlugs.includes(workspaceSlug);

  if (!workspaceAllowed) {
    return {
      allowed: false,
      reason: `Actor ${actor.name} is not assigned to ${workspaceSlug}.`
    };
  }

  if (!actor.reviewerRoles.includes(role)) {
    return {
      allowed: false,
      reason: `Actor ${actor.name} cannot review as ${role}.`
    };
  }

  return { allowed: true };
}
