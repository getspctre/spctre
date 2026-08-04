import { createHash } from "crypto";
import { logger } from "@spctre/platform/logging";
import { buildPolicyImportResult, parseAgtPolicyDocument } from "@spctre/policy-schema";
import type { PolicyImportResult } from "@spctre/policy-schema";
import { getActiveActor, requireActorAdminWorkspace } from "@/lib/actors";
import { getWorkspaceContext } from "@/lib/workspace";
import { getAuthSession } from "@/lib/auth-session";
import { findActorById } from "@/lib/actors";
import { getAppViewMode } from "@/lib/app-view-mode-server";
import { type AppViewMode } from "@/lib/app-view-mode";
import { runWithTenantContext } from "@/lib/tenant-context";
import { getPolicyDemoFallbackData } from "@/lib/repositories/demo-fallbacks";
import {
  getBranchForRollback,
  getBranchWithPublishStatus,
  getLatestPublishedBundle,
  importPolicyBranchIdempotent,
  persistImportedBranch,
  publishRollbackAndActivate,
  revisionExistsOnBranch,
  listBranches,
  listRules,
  deletePolicyBranch,
} from "@/lib/repositories/policy";
import type { ImportPolicyBranchResult } from "@/lib/repositories/policy";
import {
  insertAuthorizationDenialEvent,
  resolveWorkspaceForAction,
} from "@/lib/repositories/workspace";
import { isDatabaseConfigured } from "@/lib/repositories/shared/database";
import { reservedStableRuleIdError } from "@/lib/policy/reserved-rule-ids";
import { swallow } from "@/lib/platform/swallow";

const VALID_SCOPES = new Set(["ORGANIZATION", "WORKSPACE", "ENVIRONMENT", "CONNECTOR"]);

type ParsedPolicyDocument = ReturnType<typeof parseAgtPolicyDocument>;

/**
 * Shared input validation + parse for both the browser-session import
 * (importPolicyDecision) and the token-authenticated automation import
 * (importPolicyForToken). Returns a parse-error string or the parsed document.
 */
function validateAndParseImport(input: {
  source: string;
  branchName: string;
  scope: string;
  environment: string;
  connector: string;
  sourcePath: string;
}): { error: string } | { parsed: ParsedPolicyDocument } {
  if (!input.source.trim()) return { error: "Policy source is required." };
  if (!input.branchName) return { error: "Branch name is required." };
  if (!/^[a-z0-9][a-z0-9/-]*[a-z0-9]$|^[a-z0-9]$/.test(input.branchName)) {
    return {
      error:
        "Branch name must use only lowercase letters, digits, hyphens, and slashes, and cannot start or end with a hyphen or slash.",
    };
  }
  if (!VALID_SCOPES.has(input.scope)) return { error: "Invalid scope value." };
  if (input.scope === "ENVIRONMENT" && !input.environment) {
    return { error: "Environment is required for ENVIRONMENT-scoped branches." };
  }
  if (input.scope === "CONNECTOR" && !input.connector) {
    return { error: "Connector is required for CONNECTOR-scoped branches." };
  }
  // connector / environment are part of the branch identity, so they are only
  // meaningful for their own scope. Rejecting them elsewhere prevents, e.g., a
  // WORKSPACE import with a connector silently creating a connector-keyed branch.
  if (input.scope !== "CONNECTOR" && input.connector) {
    return { error: "Connector is only valid for CONNECTOR-scoped branches." };
  }
  if (input.scope !== "ENVIRONMENT" && input.environment) {
    return { error: "Environment is only valid for ENVIRONMENT-scoped branches." };
  }

  const parsed = parseAgtPolicyDocument({ document: input.source, sourcePath: input.sourcePath });
  if (parsed.diagnostics.some((d) => d.severity === "ERROR")) {
    return {
      error: `Parse error: ${parsed.diagnostics
        .filter((d) => d.severity === "ERROR")
        .map((d) => d.message)
        .join("; ")}`,
    };
  }

  const seenRuleIds = new Set<string>();
  for (const rule of parsed.rules) {
    if (seenRuleIds.has(rule.stableRuleId)) {
      return { error: `Duplicate stable rule ID in policy document: ${rule.stableRuleId}` };
    }
    seenRuleIds.add(rule.stableRuleId);
  }

  const reservedRuleIdError = reservedStableRuleIdError(seenRuleIds);
  if (reservedRuleIdError) return { error: reservedRuleIdError };

  return { parsed };
}

export type ImportPolicyResult = { result: PolicyImportResult } | { error: string };

export type CreatePolicyBranchResult = { branchId: string; revisionId: string } | { error: string };

export async function listPolicyRules(params: {
  workspaceId: string;
  tenantId: string;
  searchText?: string;
}) {
  return runWithTenantContext(params.tenantId, () =>
    listRules(params.workspaceId, params.tenantId, params.searchText),
  );
}

export async function getLatestPublishedPolicyBundle(params: {
  workspaceId: string;
  tenantId: string;
}) {
  return runWithTenantContext(params.tenantId, () =>
    getLatestPublishedBundle(params.workspaceId, params.tenantId),
  );
}

export async function importPolicyDecision(input: {
  source: string;
  branchName: string;
  scope: string;
  environment: string;
  connector: string;
  requestedWorkspaceId: string;
  sourcePath: string;
  targetStacks: string[];
}): Promise<ImportPolicyResult> {
  const validation = validateAndParseImport(input);
  if ("error" in validation) return validation;
  const parsed = validation.parsed;

  if (!isDatabaseConfigured()) {
    return {
      result: buildPolicyImportResult({
        id: crypto.randomUUID(),
        branchId: `br-${input.branchName}`,
        revisionId: crypto.randomUUID(),
        sourceFormat: "AGT_YAML",
        sourcePath: input.sourcePath,
        sourceHash: `sha256:${createHash("sha256").update(input.source).digest("hex").slice(0, 16)}`,
        author: "system",
        importedAt: new Date().toISOString(),
        rules: parsed.rules,
        warnings: parsed.warnings,
        diagnostics: parsed.diagnostics,
        metadata: parsed.metadata,
      }),
    };
  }

  try {
    const workspaceContext = await getWorkspaceContext();
    const tenantId = workspaceContext.tenantId;
    const targetWorkspace = await resolveWorkspaceForAction({
      tenantId,
      requestedWorkspaceId: input.requestedWorkspaceId,
      fallbackWorkspaceId: workspaceContext.workspaceId,
    });
    if (!targetWorkspace) return { error: "Workspace not found." };

    const { actor } = await getActiveActor({ workspaceId: targetWorkspace.id, tenantId });
    const adminCheck = requireActorAdminWorkspace(actor, targetWorkspace.slug);
    if (!adminCheck.allowed) {
      await insertAuthorizationDenialEvent({
        tenantId,
        action: "policy.import",
        reason: adminCheck.reason,
        resourceType: "workspace",
        resourceId: targetWorkspace.id,
        principalId: actor.id,
        workspaceId: targetWorkspace.id,
      });
      return { error: adminCheck.reason };
    }

    const persisted = await persistImportedBranch({
      tenantId,
      authorId: actor.id,
      branchName: input.branchName,
      scope: input.scope,
      workspaceId: targetWorkspace.id,
      environment: input.environment || undefined,
      connector: input.connector || undefined,
      sourcePath: input.sourcePath,
      source: input.source,
      rules: parsed.rules,
      metadata: parsed.metadata,
      sourceDocument: parsed.sourceDocument,
      compatibility: parsed.compatibility,
      message: "Import via Spctre control plane",
      targetStacks: input.targetStacks,
    });

    return {
      result: buildPolicyImportResult({
        id: crypto.randomUUID(),
        branchId: persisted.branchId,
        revisionId: persisted.revisionId,
        sourceFormat: "AGT_YAML",
        sourcePath: input.sourcePath,
        sourceHash: persisted.sourceHash,
        author: actor.name,
        importedAt: persisted.importedAt,
        rules: parsed.rules,
        warnings: parsed.warnings,
        diagnostics: parsed.diagnostics,
        metadata: parsed.metadata,
      }),
    };
  } catch (error) {
    logger.error("[importPolicyDecision] database error:", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { error: "An unexpected error occurred. Please try again." };
  }
}

export type ImportPolicyForTokenResult =
  { result: ImportPolicyBranchResult & { ruleCount: number } } | { error: string; status?: number };

/**
 * Token-authenticated, idempotent policy import for automation/CI. The caller
 * has already been authenticated against the `policy:import` scope and carries
 * its own tenant/workspace/principal from the service token, so authorization
 * is the scope itself — there is no browser session or Admin-actor lookup here.
 *
 * Never approves or publishes: it only drafts a branch/revision. Re-importing
 * unchanged source is a no-op (alreadyCurrent); changed source appends a new
 * unapproved draft revision to the same branch.
 */
export async function importPolicyForToken(input: {
  tenantId: string;
  workspaceId: string;
  principalId: string;
  source: string;
  branchName: string;
  scope: string;
  environment: string;
  connector: string;
  sourcePath: string;
  targetStacks: string[];
}): Promise<ImportPolicyForTokenResult> {
  // Service tokens are workspace-bound (service_token.workspace_id is NOT NULL).
  // An ORGANIZATION-scoped import would produce a workspace_id = NULL branch,
  // letting a workspace-scoped credential draft organization-wide policy — a
  // tenant/privilege-boundary surprise. Reject it on the token path.
  if (input.scope === "ORGANIZATION") {
    return {
      error: "Service tokens are workspace-bound; ORGANIZATION-scoped import is not supported.",
      status: 400,
    };
  }

  const validation = validateAndParseImport(input);
  if ("error" in validation) return { error: validation.error, status: 400 };
  const parsed = validation.parsed;

  // A rules-empty document parses with only a WARNING, but an empty revision
  // that reaches publication becomes a default-allow policy. The automation
  // path must never import one. (The browser importer keeps a human in the
  // loop; this guard covers the unattended operator/CI path.)
  if (parsed.rules.length === 0) {
    return {
      error: "Policy document contains no rules; refusing to import an empty policy.",
      status: 400,
    };
  }
  // Reject match-all rules: a rule with no connector, action, or domain target
  // matches every request, which is a default-allow/deny footgun on import.
  const untargeted = parsed.rules.find(
    (rule) =>
      (rule.connectors?.length ?? 0) === 0 &&
      (rule.actions?.length ?? 0) === 0 &&
      (rule.domains?.length ?? 0) === 0,
  );
  if (untargeted) {
    return {
      error: `Rule "${untargeted.stableRuleId}" has no connector, action, or domain target; refusing to import a match-all rule.`,
      status: 400,
    };
  }

  try {
    const imported = await runWithTenantContext(input.tenantId, () =>
      importPolicyBranchIdempotent({
        tenantId: input.tenantId,
        authorId: input.principalId,
        branchName: input.branchName,
        scope: input.scope,
        workspaceId: input.workspaceId,
        environment: input.environment || undefined,
        connector: input.connector || undefined,
        sourcePath: input.sourcePath,
        source: input.source,
        rules: parsed.rules,
        metadata: parsed.metadata,
        sourceDocument: parsed.sourceDocument,
        compatibility: parsed.compatibility,
        message: "Import via policy:import token",
        targetStacks: input.targetStacks,
      }),
    );
    return { result: { ...imported, ruleCount: parsed.rules.length } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Workspace is not available")) {
      return { error: "Workspace not found.", status: 404 };
    }
    logger.error("[importPolicyForToken] import failed:", { error: message });
    return { error: "An unexpected error occurred. Please try again.", status: 500 };
  }
}

/** Creates the empty, revision-backed draft that the in-app rule author uses. */
export async function createPolicyBranchDecision(input: {
  branchName: string;
  purpose: string;
  scope: string;
  environment: string;
  connector: string;
  requestedWorkspaceId: string;
  targetStacks: string[];
}): Promise<CreatePolicyBranchResult> {
  if (!input.branchName) return { error: "Branch name is required." };
  if (!input.purpose) return { error: "Policy purpose is required." };
  if (!/^[a-z0-9][a-z0-9/-]*[a-z0-9]$|^[a-z0-9]$/.test(input.branchName)) {
    return {
      error:
        "Branch name must use only lowercase letters, digits, hyphens, and slashes, and cannot start or end with a hyphen or slash.",
    };
  }
  if (!VALID_SCOPES.has(input.scope)) return { error: "Invalid scope value." };
  if (input.scope === "ENVIRONMENT" && !input.environment) {
    return { error: "Environment is required for ENVIRONMENT-scoped branches." };
  }
  if (input.scope === "CONNECTOR" && !input.connector) {
    return { error: "Connector is required for CONNECTOR-scoped branches." };
  }

  const branchId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  if (!isDatabaseConfigured()) return { branchId, revisionId };

  try {
    const workspaceContext = await getWorkspaceContext();
    const tenantId = workspaceContext.tenantId;
    const targetWorkspace = await resolveWorkspaceForAction({
      tenantId,
      requestedWorkspaceId: input.requestedWorkspaceId,
      fallbackWorkspaceId: workspaceContext.workspaceId,
    });
    if (!targetWorkspace) return { error: "Workspace not found." };

    const { actor } = await getActiveActor({ workspaceId: targetWorkspace.id, tenantId });
    const adminCheck = requireActorAdminWorkspace(actor, targetWorkspace.slug);
    if (!adminCheck.allowed) {
      await insertAuthorizationDenialEvent({
        tenantId,
        action: "policy.create",
        reason: adminCheck.reason,
        resourceType: "workspace",
        resourceId: targetWorkspace.id,
        principalId: actor.id,
        workspaceId: targetWorkspace.id,
      });
      return { error: adminCheck.reason };
    }

    const sourceDocument = {
      name: input.branchName,
      rules: [],
      metadata: { authoredInApp: true, emptyDraft: true, purpose: input.purpose },
    };
    const persisted = await persistImportedBranch({
      tenantId,
      authorId: actor.id,
      branchName: input.branchName,
      scope: input.scope,
      workspaceId: targetWorkspace.id,
      environment: input.environment || undefined,
      connector: input.connector || undefined,
      sourcePath: "ui/policy-branch-create",
      source: JSON.stringify(sourceDocument),
      rules: [],
      metadata: sourceDocument.metadata,
      sourceDocument,
      message: "Create empty draft via Spctre control plane",
      targetStacks: input.targetStacks,
    });

    return { branchId: persisted.branchId, revisionId: persisted.revisionId };
  } catch (error) {
    logger.error("[createPolicyBranchDecision] database error:", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { error: "An unexpected error occurred. Please try again." };
  }
}

export type RollbackBranchResult = { artifactHash: string; revisionId: string } | { error: string };

export async function rollbackBranchDecision(input: {
  branchId: string;
  targetRevisionId: string;
}): Promise<RollbackBranchResult> {
  if (!isDatabaseConfigured()) return { error: "Database not configured." };
  if (!input.branchId || !input.targetRevisionId) return { error: "Missing branch or revision." };

  const workspaceContext = await getWorkspaceContext();
  const tenantId = workspaceContext.tenantId;

  const branch = await getBranchForRollback({ tenantId, branchId: input.branchId });
  if (!branch) return { error: "Branch not found." };

  const { actor } = await getActiveActor({
    workspaceId: branch.workspace_id ?? workspaceContext.workspaceId,
    tenantId,
  });
  const adminCheck = requireActorAdminWorkspace(
    actor,
    branch.workspace_slug ?? workspaceContext.workspaceSlug,
  );
  if (!adminCheck.allowed) {
    await insertAuthorizationDenialEvent({
      tenantId,
      action: "branch.rollback",
      reason: adminCheck.reason,
      resourceType: "policy_branch",
      resourceId: input.branchId,
      principalId: actor.id,
      workspaceId: branch.workspace_id,
    });
    return { error: adminCheck.reason };
  }

  const revisionExists = await revisionExistsOnBranch({
    tenantId,
    branchId: input.branchId,
    targetRevisionId: input.targetRevisionId,
    workspaceId: branch.workspace_id,
  });
  if (!revisionExists) return { error: "Revision not found on this branch." };

  const artifactHash = `sha256:${createHash("sha256")
    .update(`rollback-${input.targetRevisionId}`)
    .digest("hex")
    .slice(0, 16)}`;

  try {
    await publishRollbackAndActivate({
      tenantId,
      branchId: input.branchId,
      targetRevisionId: input.targetRevisionId,
      artifactHash,
      actorId: actor.id,
    });
  } catch (error) {
    logger.error("[rollbackBranchDecision] database error:", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { error: "An unexpected error occurred. Please try again." };
  }

  return { artifactHash, revisionId: input.targetRevisionId };
}

export async function deleteUnpublishedBranchDecision(params: {
  tenantId: string;
  branchId: string;
  confirmation: string;
}): Promise<{ success: true } | { error: string }> {
  const branch = await getBranchWithPublishStatus({
    tenantId: params.tenantId,
    branchId: params.branchId,
  });
  if (!branch) return { error: "Branch not found." };
  if (params.confirmation.trim() !== branch.name) {
    return { error: `Type the branch name exactly to delete: ${branch.name}` };
  }
  if (branch.has_published_revision) {
    return { error: "This branch has published revisions and cannot be deleted." };
  }

  await deletePolicyBranch({ tenantId: params.tenantId, branchId: params.branchId });
  return { success: true };
}

export interface PoliciesPageModel {
  workspaceContext: Awaited<ReturnType<typeof getWorkspaceContext>>;
  appViewMode: AppViewMode;
  isAdmin: boolean;
  branches: Awaited<ReturnType<typeof listBranches>>;
  rules: Awaited<ReturnType<typeof listRules>>;
  session: Awaited<ReturnType<typeof getAuthSession>>;
  degraded: boolean;
}

export async function getPoliciesPageModel(params: {
  workspaceSlug?: string;
}): Promise<PoliciesPageModel> {
  const workspaceContext = await getWorkspaceContext({ workspaceSlug: params.workspaceSlug });
  const appViewMode = await getAppViewMode();

  const session = await getAuthSession().catch(swallow("getAuthSession", null));
  const actor = session
    ? await findActorById(session.principalId, {
        tenantId: session.tenantId,
        workspaceId: workspaceContext.workspaceId,
      }).catch(swallow("findActorById", null))
    : null;
  const isAdmin = Boolean(actor?.reviewerRoles.includes("Admin"));

  const fallback = getPolicyDemoFallbackData(workspaceContext.tenantId);
  let branches = fallback.branches;
  let rules = fallback.rules;
  let degraded = false;

  if (isDatabaseConfigured()) {
    try {
      const [dbBranches, dbRules] = await runWithTenantContext(workspaceContext.tenantId, () =>
        Promise.all([
          listBranches(workspaceContext.workspaceId, workspaceContext.tenantId),
          listRules(workspaceContext.workspaceId, workspaceContext.tenantId),
        ]),
      );
      if (dbBranches.length || dbRules.length) {
        branches = dbBranches;
        rules = dbRules;
      }
    } catch (err) {
      degraded = true;
      // Degrade to the demo/empty lists, but keep the failure visible: this
      // catch also swallows query and RLS errors, not just "no database".
      logger.warn("Policy page branch/rule query failed; using fallback data", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { workspaceContext, appViewMode, isAdmin, branches, rules, session, degraded };
}
