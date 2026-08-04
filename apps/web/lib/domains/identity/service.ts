import { runWithTenantContext } from "@/lib/tenant-context";
import { appendOperationsLog } from "@/lib/repositories/operations-log";
import {
  createAgentSurfaceBinding,
  deleteAgentSurfaceBinding,
  listAgentSurfaceBindings,
  listApiKeysForWorkspace,
  listCrossSurfaceIdentityHistory,
  listIdentityLifecycleEvents,
  recordIdentityLifecycleEvent,
} from "@/lib/repositories/identity";
import type {
  AgentSurfaceBinding,
  AgentSurfaceType,
  CrossSurfaceIdentityHistory,
  IdentityLifecycleEventType,
} from "@spctre/policy-schema";

export async function recordIdentityEvent(
  params: Parameters<typeof recordIdentityLifecycleEvent>[0],
) {
  return recordIdentityLifecycleEvent(params);
}

export async function listIdentityEvents(params: {
  tenantId: string;
  principalId?: string;
  eventType?: IdentityLifecycleEventType;
  limit: number;
}) {
  return listIdentityLifecycleEvents(params.tenantId, {
    principalId: params.principalId,
    eventType: params.eventType,
    limit: params.limit,
  });
}

export async function recordIdentityOperation(params: Parameters<typeof appendOperationsLog>[0]) {
  return appendOperationsLog(params);
}

export async function linkAgentSurface(params: {
  tenantId: string;
  workspaceId: string;
  canonicalAgentId: string;
  surfaceType: AgentSurfaceType;
  surfaceAgentId: string;
  actorId: string;
}): Promise<AgentSurfaceBinding | null> {
  return runWithTenantContext(params.tenantId, () => linkAgentSurfaceInTenant(params));
}

async function linkAgentSurfaceInTenant(params: {
  tenantId: string;
  workspaceId: string;
  canonicalAgentId: string;
  surfaceType: AgentSurfaceType;
  surfaceAgentId: string;
  actorId: string;
}): Promise<AgentSurfaceBinding | null> {
  const binding = await createAgentSurfaceBinding({
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    canonicalAgentId: params.canonicalAgentId,
    surfaceType: params.surfaceType,
    surfaceAgentId: params.surfaceAgentId,
    createdBy: params.actorId,
  });
  if (binding) {
    await recordIdentityLifecycleEvent({
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      principalId: params.canonicalAgentId,
      eventType: "SURFACE_LINKED",
      actorId: params.actorId,
      source: "API",
      detail: {
        surfaceType: params.surfaceType,
        surfaceAgentId: params.surfaceAgentId,
        bindingId: binding.id,
      },
    });
  }
  return binding;
}

export async function unlinkAgentSurface(params: {
  bindingId: string;
  tenantId: string;
  workspaceId: string;
  canonicalAgentId: string;
  surfaceType: AgentSurfaceType;
  surfaceAgentId: string;
  actorId: string;
}): Promise<boolean> {
  return runWithTenantContext(params.tenantId, () => unlinkAgentSurfaceInTenant(params));
}

async function unlinkAgentSurfaceInTenant(params: {
  bindingId: string;
  tenantId: string;
  workspaceId: string;
  canonicalAgentId: string;
  surfaceType: AgentSurfaceType;
  surfaceAgentId: string;
  actorId: string;
}): Promise<boolean> {
  const ok = await deleteAgentSurfaceBinding({
    id: params.bindingId,
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
  });
  if (ok) {
    await recordIdentityLifecycleEvent({
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      principalId: params.canonicalAgentId,
      eventType: "SURFACE_UNLINKED",
      actorId: params.actorId,
      source: "API",
      detail: {
        surfaceType: params.surfaceType,
        surfaceAgentId: params.surfaceAgentId,
        bindingId: params.bindingId,
      },
    });
  }
  return ok;
}

export async function listAgentSurfaces(params: {
  tenantId: string;
  workspaceId: string;
  canonicalAgentId: string;
}): Promise<AgentSurfaceBinding[]> {
  return runWithTenantContext(params.tenantId, () => listAgentSurfaceBindings(params));
}

/**
 * Unified cross-surface identity history for a canonical agent: decisions,
 * trust changes, identity lifecycle events, and reviewer resolutions correlated
 * across every bound runtime surface. `agentId` may be canonical or a bound
 * surface identity; it is resolved to canonical inside the repository.
 */
export async function listCrossSurfaceHistory(params: {
  tenantId: string;
  workspaceId: string;
  agentId: string;
  limit: number;
}): Promise<CrossSurfaceIdentityHistory> {
  return runWithTenantContext(params.tenantId, () => listCrossSurfaceIdentityHistory(params));
}

export async function listWorkspaceApiKeys(params: Parameters<typeof listApiKeysForWorkspace>[0]) {
  return listApiKeysForWorkspace(params);
}
