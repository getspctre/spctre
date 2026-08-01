import { redirect } from "next/navigation";
import { logger } from "@spctre/platform/logging";
import { getAuthSession } from "@/lib/auth-session";
import type { ActiveScope } from "@/lib/workspace";
import {
  verifyWorkspaceOwnership,
  listWorkspaceSlugsWithPrefix,
  insertWorkspace,
  getFirstWorkspaceId,
  insertAdminAuditEvent,
  countTenantWorkspaces,
  getCommercialProfile,
  checkSlugInUse,
  normalizeWorkspaceContext,
  updateWorkspaceDetails,
  verifyWorkspaceSlugForToken,
  deleteWorkspaceById,
  listWorkspacesForTenant,
} from "@/lib/repositories/workspace";
import { getPrincipalSubject } from "@/lib/repositories/auth/principal";
import {
  ensureAuthDemoTenant,
  getTenantRequireMfa,
  getTenantPrincipalBySubject,
  updateSessionForTenantSwitch,
  updateSessionForActorSwitch,
} from "@/lib/repositories/auth/session";
import { ensureDefaultPublishedPolicyPack } from "@/lib/repositories/default-policy";
import { findActorById } from "@/lib/actors";
import { verifyWriteAccess } from "@/lib/demo-guard";
import { isDatabaseConfigured } from "@/lib/repositories/shared/database";
import {
  listBranchStatusSummariesForTenant,
  listBranches,
  listLatestPublishedBundleSummariesForTenant,
} from "@/lib/repositories/policy";
import { countOpenEscalations, listOpenEscalationQueue } from "@/lib/repositories/gateway";
import { swallow } from "@/lib/platform/swallow";

export function isWorkspaceDatabaseConfigured(): boolean {
  return isDatabaseConfigured();
}

export async function normalizeWorkspaceSelection(params: {
  sessionTenantId: string;
  principalSubject: string;
  requestedTenantId: string;
  requestedWorkspaceId: string;
}) {
  return normalizeWorkspaceContext(params);
}

export async function verifyWorkspaceSlugForServiceToken(params: {
  tenantId: string;
  workspaceSlug: string;
  workspaceId: string;
}) {
  return verifyWorkspaceSlugForToken(params);
}

export async function listWorkspaceApiSummaries(tenantId: string) {
  const [workspaces, publishedByWorkspace, branchesByWorkspace] = await Promise.all([
    listWorkspacesForTenant(tenantId),
    listLatestPublishedBundleSummariesForTenant(tenantId),
    listBranchStatusSummariesForTenant(tenantId),
  ]);

  return workspaces.map((workspace) => {
    const bundle = publishedByWorkspace.get(workspace.id) ?? null;
    const branchSummary = branchesByWorkspace.get(workspace.id);
    return {
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      publicationStatus: bundle ? "PUBLISHED" : branchSummary?.hasInReview ? "IN_REVIEW" : "DRAFT",
      activeBranchId: bundle?.branchId ?? branchSummary?.firstBranchId ?? null,
      revisionId: bundle?.revisionId ?? null,
      artifactHash: bundle?.artifactHash ?? null,
      publishedAt: bundle?.publishedAt ?? null,
    };
  });
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export async function switchWorkspace(params: {
  workspaceId: string;
  tenantId: string;
}): Promise<{ ok: true } | { error: string }> {
  if (isDatabaseConfigured()) {
    await ensureAuthDemoTenant();
    const found = await verifyWorkspaceOwnership({
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
    });
    if (!found) return { error: "Workspace not found." };
  }
  return { ok: true };
}

export async function createWorkspace(params: {
  tenantId: string;
  principalId: string;
  workspaceName: string;
}): Promise<{ ok: true; workspaceId: string; slug: string } | { error: string }> {
  if (!isDatabaseConfigured()) return { error: "Database not configured." };

  await ensureAuthDemoTenant();

  // Enforce plan-aware workspace limits
  const profile = await getCommercialProfile(params.tenantId).catch(swallow("getCommercialProfile", null));
  const planCode = profile?.planCode ?? "HOSTED_TRIAL";
  const wsCount = await countTenantWorkspaces(params.tenantId).catch(swallow("countTenantWorkspaces", 0));

  let limit = 1;
  if (planCode === "TEAM") limit = 3;
  else if (planCode === "BUSINESS") limit = 12;
  else if (planCode === "ENTERPRISE") limit = 50;

  if (wsCount >= limit) {
    return { error: `Your current plan (${planCode}) is limited to ${limit} workspace(s). Upgrade your plan to create more workspaces.` };
  }

  const writeCheck = verifyWriteAccess(params.tenantId);
  if (!writeCheck.allowed) return { error: writeCheck.error || "Write access denied." };

  const actor = await findActorById(params.principalId, { tenantId: params.tenantId }).catch(swallow("findActorById", null));
  if (!actor || !actor.reviewerRoles.includes("Admin")) {
    await insertAdminAuditEvent({
      tenantId: params.tenantId,
      principalId: params.principalId || null,
      action: "workspace.create",
      targetType: "workspace",
      outcome: "DENIED",
      reason: "Admin permission is required to create workspaces."
    }).catch(swallow("insertAdminAuditEvent", undefined));
    return { error: "Admin permission is required to create workspaces." };
  }

  const workspaceName = params.workspaceName.trim();
  if (!workspaceName) return { error: "Workspace name is required." };

  const baseSlug = slugify(workspaceName);
  if (!baseSlug) return { error: "Workspace name must include letters or numbers." };

  const existingSlugs = await listWorkspaceSlugsWithPrefix({ tenantId: params.tenantId, prefix: baseSlug });

  const used = new Set(existingSlugs);
  let slug = baseSlug;
  let suffix = 2;
  while (used.has(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  const workspaceId = crypto.randomUUID();
  await insertWorkspace({ id: workspaceId, tenantId: params.tenantId, slug, name: workspaceName });
  await ensureDefaultPublishedPolicyPack({
    tenantId: params.tenantId,
    workspaceId,
    actorId: params.principalId,
  });

  await insertAdminAuditEvent({
    tenantId: params.tenantId,
    workspaceId,
    principalId: params.principalId,
    action: "workspace.create",
    targetType: "workspace",
    targetId: workspaceId,
    outcome: "ALLOWED",
    metadata: { slug, workspaceName }
  }).catch(swallow("insertAdminAuditEvent", undefined));

  return { ok: true, workspaceId, slug };
}

export async function switchTenant(params: {
  tenantId: string;
  currentTenantId: string;
  principalId: string;
  subject: string;
  sessionId: string | undefined;
}): Promise<{ ok: true; firstWorkspaceId: string | null; firstWorkspaceSlug: string | null; requiresMfa?: boolean; targetPrincipalId?: string; targetPrincipalSubject?: string } | { error: string }> {
  if (isDatabaseConfigured()) {
    await ensureAuthDemoTenant();

    const actor = await findActorById(params.principalId, { tenantId: params.currentTenantId }).catch(swallow("findActorById", null));
    if (!actor || !actor.reviewerRoles.includes("Admin")) {
      await insertAdminAuditEvent({
        tenantId: params.currentTenantId,
        principalId: params.principalId || null,
        action: "tenant.switch",
        targetType: "tenant",
        targetId: params.tenantId,
        outcome: "DENIED",
        reason: "Admin permission is required to switch tenants."
      }).catch(swallow("insertAdminAuditEvent", undefined));
      return { error: "Admin permission is required to switch tenants." };
    }

    const targetTenant = await getTenantPrincipalBySubject({ tenantId: params.tenantId, subject: params.subject });
    if (!targetTenant) return { error: "Tenant is not available to the signed-in principal." };

    // `listWorkspacesForTenant` and `getFirstWorkspaceId` both order by created_at ASC,
    // so the first row is the same workspace — one query yields both id and slug.
    const firstWorkspace = (await listWorkspacesForTenant(params.tenantId))[0] ?? null;
    const firstWorkspaceId = firstWorkspace?.id ?? null;
    const firstWorkspaceSlug = firstWorkspace?.slug ?? null;
    let targetRequiresMfa = false;

    if (params.sessionId) {
      targetRequiresMfa = (await getTenantRequireMfa(params.tenantId)) ?? false;

      await updateSessionForTenantSwitch({
        sessionId: params.sessionId,
        tenantId: params.tenantId,
        principalId: targetTenant.principal_id,
        requireMfa: targetRequiresMfa,
      });
    }

    await insertAdminAuditEvent({
      tenantId: params.currentTenantId,
      workspaceId: firstWorkspaceId ?? null,
      principalId: params.principalId,
      action: "tenant.switch",
      targetType: "tenant",
      targetId: params.tenantId,
      outcome: "ALLOWED"
    }).catch(swallow("insertAdminAuditEvent", undefined));

    return {
      ok: true,
      firstWorkspaceId,
      firstWorkspaceSlug,
      requiresMfa: targetRequiresMfa,
      targetPrincipalId: targetTenant.principal_id,
      targetPrincipalSubject: targetTenant.principal_subject,
    };
  }

  return { ok: true, firstWorkspaceId: null, firstWorkspaceSlug: null };
}

export async function switchActor(params: {
  actorId: string;
  currentPrincipalId: string;
  workspaceId: string | undefined;
  tenantId: string;
  sessionId: string | undefined;
}): Promise<{ ok: true; actorSubject: string } | { error: string }> {
  if (!isDatabaseConfigured()) return { error: "Database not configured." };

  const { DEMO_TENANT_ID } = await import("@/lib/demo");
  const isDemo = params.tenantId === DEMO_TENANT_ID;
  if (!isDemo) {
    const adminActor = await findActorById(params.currentPrincipalId, { tenantId: params.tenantId, workspaceId: params.workspaceId }).catch(swallow("findActorById", null));
    if (!adminActor || !adminActor.reviewerRoles.includes("Admin")) {
      await insertAdminAuditEvent({
        tenantId: params.tenantId,
        workspaceId: params.workspaceId,
        principalId: params.currentPrincipalId || null,
        action: "actor.switch",
        targetType: "principal",
        targetId: params.actorId,
        outcome: "DENIED",
        reason: "Admin permission is required to switch active actor."
      }).catch(swallow("insertAdminAuditEvent", undefined));
      return { error: "Admin permission is required to switch active actor." };
    }
  }

  const actor = await findActorById(params.actorId, { tenantId: params.tenantId, workspaceId: params.workspaceId }).catch(swallow("findActorById", null));
  if (!actor) return { error: "Actor is not available for this tenant/workspace." };

  const actorSubject = await getPrincipalSubject({ tenantId: params.tenantId, principalId: params.actorId });
  if (!actorSubject) return { error: "Actor subject is not available for this tenant." };

  if (!params.sessionId) return { error: "No active session." };

  await updateSessionForActorSwitch({ sessionId: params.sessionId, tenantId: params.tenantId, principalId: params.actorId });

  await insertAdminAuditEvent({
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    principalId: params.currentPrincipalId,
    action: "actor.switch",
    targetType: "principal",
    targetId: params.actorId,
    outcome: "ALLOWED"
  }).catch(swallow("insertAdminAuditEvent", undefined));

  return { ok: true, actorSubject };
}

export async function createWorkspaceAdmin(params: {
  tenantId: string;
  principalId: string;
  workspaceName: string;
  workspaceSlug: string;
}): Promise<{ ok: true; slug: string } | { error: string }> {
  if (!isDatabaseConfigured()) return { error: "Database not configured." };

  const writeCheck = verifyWriteAccess(params.tenantId);
  if (!writeCheck.allowed) return { error: writeCheck.error ?? "Write access denied." };

  const workspaceName = params.workspaceName.trim();
  if (!workspaceName) return { error: "Workspace name is required." };

  const baseSlug = normalizeSlug(params.workspaceSlug) || slugify(workspaceName);
  if (!baseSlug) return { error: "Workspace slug must include letters or numbers." };

  const existingSlugs = await listWorkspaceSlugsWithPrefix({
    tenantId: params.tenantId,
    prefix: baseSlug,
  });

  const used = new Set(existingSlugs);
  let slug = baseSlug;
  let suffix = 2;
  while (used.has(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  const workspaceId = crypto.randomUUID();
  await insertWorkspace({ id: workspaceId, tenantId: params.tenantId, slug, name: workspaceName });
  await ensureDefaultPublishedPolicyPack({
    tenantId: params.tenantId,
    workspaceId,
    actorId: params.principalId,
  });

  return { ok: true, slug };
}

export async function updateWorkspaceAdmin(params: {
  tenantId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
}): Promise<{ ok: true; slug: string } | { error: string }> {
  if (!isDatabaseConfigured()) return { error: "Database not configured." };

  const writeCheck = verifyWriteAccess(params.tenantId);
  if (!writeCheck.allowed) return { error: writeCheck.error ?? "Write access denied." };

  const workspaceId = params.workspaceId.trim();
  const workspaceName = params.workspaceName.trim();
  const requestedSlug = params.workspaceSlug.trim();

  if (!workspaceId || !workspaceName || !requestedSlug) {
    return { error: "Workspace ID, name, and slug are required." };
  }

  const workspaceOk = await verifyWorkspaceOwnership({ tenantId: params.tenantId, workspaceId });
  if (!workspaceOk) return { error: "Workspace not found." };

  const slug = normalizeSlug(requestedSlug);
  if (!slug) return { error: "Workspace slug must include letters or numbers." };

  const slugTaken = await checkSlugInUse({ tenantId: params.tenantId, slug, excludeWorkspaceId: workspaceId });
  if (slugTaken) return { error: "Workspace slug is already in use." };

  await updateWorkspaceDetails({ tenantId: params.tenantId, workspaceId, name: workspaceName, slug });

  return { ok: true, slug };
}

export async function deleteWorkspaceAdmin(params: {
  tenantId: string;
  workspaceId: string;
  activeWorkspaceId: string | undefined;
}): Promise<{ ok: true; slug: string; fallbackWorkspaceId?: string } | { error: string }> {
  if (!isDatabaseConfigured()) return { error: "Database not configured." };

  const writeCheck = verifyWriteAccess(params.tenantId);
  if (!writeCheck.allowed) return { error: writeCheck.error ?? "Write access denied." };

  if (!params.workspaceId) return { error: "Workspace ID is required." };
  if (params.activeWorkspaceId === params.workspaceId) {
    return { error: "Cannot delete the active workspace. Switch to another workspace first." };
  }

  const workspaceCount = await countTenantWorkspaces(params.tenantId);
  if (workspaceCount <= 1) {
    return { error: "Cannot delete the last workspace." };
  }

  const deleted = await deleteWorkspaceById({ tenantId: params.tenantId, workspaceId: params.workspaceId });
  if (!deleted) return { error: "Workspace not found." };

  let fallbackWorkspaceId: string | undefined;
  const fallbackId = await getFirstWorkspaceId(params.tenantId);
  if (fallbackId) {
    fallbackWorkspaceId = fallbackId;
  }

  return { ok: true, slug: deleted.slug, fallbackWorkspaceId };
}

export interface ShellPageModel {
  branchCount: number;
  escalationCount: number;
  escalationPreview: Array<{
    id: string;
    decisionId: string;
    status: string;
    slaDueAt: string;
    connector?: string;
    action?: string;
    riskLevel?: string;
    assignedTo?: string;
  }>;
  isAdmin: boolean;
  degraded: boolean;
}

export async function getShellPageModel(params: {
  tenantId: string;
  workspaceId: string;
  principalId: string;
}): Promise<ShellPageModel> {
  let degraded = false;
  const actor = await findActorById(params.principalId, {
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
  }).catch((error) => {
    degraded = true;
    return swallow("findActorById", null)(error);
  });
  const isAdmin = Boolean(actor?.reviewerRoles.includes("Admin"));

  let branchCount = 0;
  let escalationCount = 0;
  let escalationPreview: ShellPageModel["escalationPreview"] = [];

  if (isDatabaseConfigured()) {
    try {
      const [branches, openEscalations, openEscalationItems] = await Promise.all([
        listBranches(params.workspaceId, params.tenantId).catch((error) => {
          degraded = true;
          return swallow("listBranches", [])(error);
        }),
        countOpenEscalations(params.workspaceId, params.tenantId).catch((error) => {
          degraded = true;
          return swallow("countOpenEscalations", 0)(error);
        }),
        listOpenEscalationQueue(params.workspaceId, params.tenantId, 5).catch((error) => {
          degraded = true;
          return swallow("listOpenEscalationQueue", [])(error);
        }),
      ]);
      branchCount = branches.length;
      escalationCount = openEscalations;
      escalationPreview = openEscalationItems.map((item) => ({
        id: item.id,
        decisionId: item.decisionId,
        status: item.status,
        slaDueAt: item.slaDueAt,
        connector: item.connector,
        action: item.action,
        riskLevel: item.riskLevel,
        assignedTo: item.assignedTo,
      }));
    } catch (err) {
      // Degrade to zero counts, but keep the failure visible: this catch
      // also swallows query and RLS errors, not just "no database".
      logger.warn("Workspace overview escalation query failed; using fallback counts", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    branchCount,
    escalationCount,
    escalationPreview,
    isAdmin,
    degraded,
  };
}

export interface AdminWorkspacePageModel {
  workspaceContext: ActiveScope;
  workspaces: Awaited<ReturnType<typeof listWorkspacesForTenant>>;
}

export async function getAdminWorkspacePageModel(scope: ActiveScope): Promise<AdminWorkspacePageModel> {
  const workspaceContext = scope;
  const session = await getAuthSession().catch(swallow("getAuthSession", null));

  if (!session) {
    redirect("/login");
  }

  const actor = await findActorById(session.principalId, {
    tenantId: session.tenantId,
    workspaceId: workspaceContext.workspaceId,
  }).catch(swallow("findActorById", null));

  if (!actor?.reviewerRoles.includes("Admin")) {
    redirect("/?error=admin-required");
  }

  if (!isDatabaseConfigured()) {
    redirect("/?error=db-required");
  }

  const workspaces = await listWorkspacesForTenant(session.tenantId);

  return {
    workspaceContext,
    workspaces,
  };
}
