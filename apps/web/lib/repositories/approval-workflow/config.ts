import { sql } from "@/lib/db";
import { ALL_REVIEWER_ROLES, REQUIRED_APPROVAL_RULES } from "@/lib/approval-config";
import type { ApprovalWorkflowSnapshot, PolicyApprovalRule } from "@spctre/policy-schema";

type ReviewMode = "PARALLEL" | "SEQUENTIAL";
const REQUIRE_AGT_VERIFICATION_TAG = "verification:require-agt";
const SINGLE_REVIEWER_ROLE_PRIORITY = ["Admin", "Security", "Platform", "Legal", "Ops"] as const;

export interface ApprovalWorkflowConfigSummary {
  id: string;
  tenantId: string;
  workspaceId: string | null;
  workspaceSlug: string | null;
  workspaceName: string | null;
  environment: string | null;
  name: string;
  reviewMode: ReviewMode;
  enabled: boolean;
  riskTags: string[];
  verificationPolicy: {
    requireVerification: boolean;
  };
  allowImmediatePackPublish: boolean;
  updatedAt: string;
  rules: ApprovalWorkflowRuleSummary[];
}

interface ApprovalWorkflowRuleSummary {
  id: string;
  role: string;
  requiredCount: number;
  eligibleRoles: string[];
  namedReviewers: string[];
  sequence: number;
}

export function defaultApprovalWorkflowSnapshot(params: {
  workspaceId?: string | null;
  environment?: string | null;
  eligibleReviewerRole?: string;
} = {}): ApprovalWorkflowSnapshot {
  const rules = params.eligibleReviewerRole
    ? [{ role: params.eligibleReviewerRole, requiredCount: 1 }]
    : REQUIRED_APPROVAL_RULES;
  return {
    id: "default-static-approval-workflow",
    name: params.eligibleReviewerRole ? "Default reviewer workflow" : "Default approval workflow",
    reviewMode: "PARALLEL",
    workspaceId: params.workspaceId ?? undefined,
    environment: params.environment ?? undefined,
    rules: rules.map((rule, index) => ({
      role: rule.role,
      requiredCount: rule.requiredCount,
      eligibleRoles: [rule.role],
      sequence: index + 1,
    })),
    verificationPolicy: {
      requireVerification: false,
    },
    generatedAt: new Date().toISOString(),
  };
}

async function getDefaultEligibleReviewerRole(params: {
  tenantId: string;
  workspaceId: string | null;
}): Promise<string | null> {
  if (!sql) return null;
  const rows = await sql<{ principal_id: string; reviewer_roles: string[] }[]>`
    SELECT g.principal_id, g.reviewer_roles
    FROM principal_permission_grant g
    INNER JOIN app_principal p ON p.id = g.principal_id AND p.tenant_id = g.tenant_id
    WHERE g.tenant_id = ${params.tenantId}
      AND (g.workspace_id IS NULL OR g.workspace_id = ${params.workspaceId})
      AND p.principal_type = 'USER'
      AND p.invite_status = 'ACCEPTED'
      AND p.disabled_at IS NULL
      AND p.idp_deprovisioned_at IS NULL
  `;
  const rolesByPrincipal = new Map<string, Set<string>>();
  for (const row of rows) {
    const roles = rolesByPrincipal.get(row.principal_id) ?? new Set<string>();
    for (const role of row.reviewer_roles ?? []) {
      if ((ALL_REVIEWER_ROLES as readonly string[]).includes(role)) roles.add(role);
    }
    if (roles.size) rolesByPrincipal.set(row.principal_id, roles);
  }
  // `policy_approval` has one row per reviewer identity and revision. An
  // implicit multi-role default can therefore become impossible for a solo
  // operator as soon as any extra reviewer-capable principal exists. Keep
  // multi-role separation an explicit workflow choice; choose one lane that
  // an eligible principal can actually satisfy for the unconfigured default.
  const eligibleRoles = new Set<string>();
  for (const roles of rolesByPrincipal.values()) {
    for (const role of roles) eligibleRoles.add(role);
  }
  return SINGLE_REVIEWER_ROLE_PRIORITY.find((role) => eligibleRoles.has(role)) ?? null;
}

function verificationPolicyFromRiskTags(riskTags: string[]) {
  return {
    requireVerification: riskTags.includes(REQUIRE_AGT_VERIFICATION_TAG),
  };
}

function mapWorkflowRows(rows: {
  workflow_id: string;
  tenant_id: string;
  workspace_id: string | null;
  workspace_slug: string | null;
  workspace_name: string | null;
  environment: string | null;
  name: string;
  review_mode: ReviewMode;
  enabled: boolean;
  risk_tags: string[];
  updated_at: Date;
  rule_id: string | null;
  role: string | null;
  required_count: number | null;
  eligible_roles: string[] | null;
  named_reviewers: string[] | null;
  sequence: number | null;
}[]): ApprovalWorkflowConfigSummary[] {
  const byWorkflow = new Map<string, ApprovalWorkflowConfigSummary>();
  for (const row of rows) {
    const existing = byWorkflow.get(row.workflow_id) ?? {
      id: row.workflow_id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      workspaceSlug: row.workspace_slug,
      workspaceName: row.workspace_name,
      environment: row.environment,
      name: row.name,
      reviewMode: row.review_mode,
      enabled: row.enabled,
      riskTags: row.risk_tags ?? [],
      verificationPolicy: verificationPolicyFromRiskTags(row.risk_tags ?? []),
      allowImmediatePackPublish: (row.risk_tags ?? []).includes(ALLOW_IMMEDIATE_PACK_PUBLISH_TAG),
      updatedAt: row.updated_at.toISOString(),
      rules: [],
    };
    if (row.rule_id && row.role) {
      existing.rules.push({
        id: row.rule_id,
        role: row.role,
        requiredCount: row.required_count ?? 1,
        eligibleRoles: row.eligible_roles ?? [],
        namedReviewers: row.named_reviewers ?? [],
        sequence: row.sequence ?? existing.rules.length + 1,
      });
    }
    byWorkflow.set(row.workflow_id, existing);
  }
  return Array.from(byWorkflow.values()).map((workflow) => ({
    ...workflow,
    rules: workflow.rules.sort((a, b) => a.sequence - b.sequence),
  }));
}

function workflowToSnapshot(workflow: ApprovalWorkflowConfigSummary): ApprovalWorkflowSnapshot {
  return {
    id: workflow.id,
    name: workflow.name,
    reviewMode: workflow.reviewMode,
    workspaceId: workflow.workspaceId ?? undefined,
    environment: workflow.environment ?? undefined,
    rules: workflow.rules.map((rule) => ({
      role: rule.role,
      requiredCount: rule.requiredCount,
      eligibleRoles: rule.eligibleRoles.length ? rule.eligibleRoles : [rule.role],
      namedReviewers: rule.namedReviewers,
      sequence: rule.sequence,
    })),
    verificationPolicy: workflow.verificationPolicy,
    generatedAt: new Date().toISOString(),
  };
}

export function approvalRulesFromWorkflow(workflow: ApprovalWorkflowSnapshot): PolicyApprovalRule[] {
  if (!workflow.rules.length) {
    return [{ role: "Admin", requiredCount: 1 }];
  }
  return workflow.rules.map((rule) => ({
    role: rule.role,
    requiredCount: rule.requiredCount,
  }));
}

export async function listApprovalWorkflows(
  tenantId: string
): Promise<ApprovalWorkflowConfigSummary[]> {
  if (!sql) return [];
  const rows = await sql<Parameters<typeof mapWorkflowRows>[0]>`
    SELECT
      aw.id AS workflow_id,
      aw.tenant_id,
      aw.workspace_id,
      w.slug AS workspace_slug,
      w.name AS workspace_name,
      aw.environment,
      aw.name,
      aw.review_mode,
      aw.enabled,
      aw.risk_tags,
      aw.updated_at,
      r.id AS rule_id,
      r.role,
      r.required_count,
      r.eligible_roles,
      r.named_reviewers::text[] AS named_reviewers,
      r.sequence
    FROM approval_workflow_config aw
    LEFT JOIN workspace w ON w.id = aw.workspace_id AND w.tenant_id = aw.tenant_id
    LEFT JOIN approval_workflow_rule r ON r.workflow_id = aw.id
    WHERE aw.tenant_id = ${tenantId}
    ORDER BY aw.updated_at DESC, r.sequence ASC
  `;
  return mapWorkflowRows(rows);
}

export async function getApprovalWorkflowForContext(params: {
  tenantId?: string;
  workspaceId?: string | null;
  environment?: string | null;
}): Promise<ApprovalWorkflowSnapshot> {
  if (!sql) {
    return defaultApprovalWorkflowSnapshot({
      workspaceId: params.workspaceId,
      environment: params.environment,
    });
  }

  const tenantId = params.tenantId ?? "";
  const workspaceId = params.workspaceId ?? null;
  const environment = params.environment?.trim() || null;

  const rows = await sql<Parameters<typeof mapWorkflowRows>[0]>`
    WITH candidate_workflows AS (
      SELECT aw.*,
        CASE
          WHEN aw.workspace_id = ${workspaceId} AND aw.environment = ${environment} THEN 1
          WHEN aw.workspace_id = ${workspaceId} AND aw.environment IS NULL THEN 2
          WHEN aw.workspace_id IS NULL AND aw.environment = ${environment} THEN 3
          WHEN aw.workspace_id IS NULL AND aw.environment IS NULL THEN 4
          ELSE 99
        END AS precedence
      FROM approval_workflow_config aw
      WHERE aw.tenant_id = ${tenantId}
        AND aw.enabled = true
        AND (aw.workspace_id = ${workspaceId} OR aw.workspace_id IS NULL)
        AND (aw.environment = ${environment} OR aw.environment IS NULL)
    ),
    selected_workflow AS (
      SELECT *
      FROM candidate_workflows
      WHERE precedence < 99
      ORDER BY precedence ASC, updated_at DESC
      LIMIT 1
    )
    SELECT
      aw.id AS workflow_id,
      aw.tenant_id,
      aw.workspace_id,
      w.slug AS workspace_slug,
      w.name AS workspace_name,
      aw.environment,
      aw.name,
      aw.review_mode,
      aw.enabled,
      aw.risk_tags,
      aw.updated_at,
      r.id AS rule_id,
      r.role,
      r.required_count,
      r.eligible_roles,
      r.named_reviewers::text[] AS named_reviewers,
      r.sequence
    FROM selected_workflow aw
    LEFT JOIN workspace w ON w.id = aw.workspace_id AND w.tenant_id = aw.tenant_id
    LEFT JOIN approval_workflow_rule r ON r.workflow_id = aw.id
    ORDER BY r.sequence ASC
  `;

  const workflow = mapWorkflowRows(rows)[0];
  if (!workflow) {
    const eligibleReviewerRole = await getDefaultEligibleReviewerRole({ tenantId, workspaceId });
    return defaultApprovalWorkflowSnapshot({ workspaceId, environment, eligibleReviewerRole: eligibleReviewerRole ?? undefined });
  }
  return workflowToSnapshot(workflow);
}

export async function verifyWorkspaceForWorkflow(params: {
  tenantId: string;
  workspaceId: string;
}): Promise<boolean> {
  if (!sql) return false;
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM workspace WHERE id = ${params.workspaceId} AND tenant_id = ${params.tenantId} LIMIT 1
  `;
  return rows.length > 0;
}

export async function getExistingWorkflowForScope(params: {
  tenantId: string;
  workspaceId: string | null;
  environment: string | null;
}): Promise<string | null> {
  if (!sql) return null;
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM approval_workflow_config
    WHERE tenant_id = ${params.tenantId}
      AND workspace_id IS NOT DISTINCT FROM ${params.workspaceId}
      AND environment IS NOT DISTINCT FROM ${params.environment}
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

export async function getWorkflowRiskTags(params: {
  tenantId: string;
  workflowId: string;
}): Promise<string[]> {
  if (!sql) return [];
  const rows = await sql<{ risk_tags: string[] }[]>`
    SELECT risk_tags FROM approval_workflow_config
    WHERE id = ${params.workflowId} AND tenant_id = ${params.tenantId} LIMIT 1
  `;
  return rows[0]?.risk_tags ?? [];
}

export async function upsertWorkflowConfig(params: {
  tenantId: string;
  workflowId: string;
  name: string;
  workspaceId: string | null;
  environment: string | null;
  reviewMode: string;
  riskTags: string[];
  actorId: string;
}): Promise<string | null> {
  if (!sql) return null;
  const rows = params.workflowId
    ? await sql<{ id: string }[]>`
        UPDATE approval_workflow_config
        SET name = ${params.name}, workspace_id = ${params.workspaceId},
            environment = ${params.environment}, review_mode = ${params.reviewMode},
            risk_tags = ${params.riskTags}, enabled = true,
            updated_by = ${params.actorId}, updated_at = now()
        WHERE id = ${params.workflowId} AND tenant_id = ${params.tenantId}
        RETURNING id
      `
    : await sql<{ id: string }[]>`
        INSERT INTO approval_workflow_config (
          tenant_id, workspace_id, environment, name, review_mode, risk_tags, created_by, updated_by
        ) VALUES (
          ${params.tenantId}, ${params.workspaceId}, ${params.environment}, ${params.name},
          ${params.reviewMode}, ${params.riskTags}, ${params.actorId}, ${params.actorId}
        )
        RETURNING id
      `;
  return rows[0]?.id ?? null;
}

export async function getNextWorkflowRuleSequence(workflowId: string): Promise<number> {
  if (!sql) return 1;
  const rows = await sql<{ sequence: number }[]>`
    SELECT coalesce(max(sequence), 0)::int + 1 AS sequence
    FROM approval_workflow_rule WHERE workflow_id = ${workflowId}
  `;
  return rows[0]?.sequence ?? 1;
}

export async function upsertWorkflowRule(params: {
  workflowId: string;
  sequence: number;
  role: string;
  requiredCount: number;
  eligibleRoles: string[];
}): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO approval_workflow_rule (workflow_id, sequence, role, required_count, eligible_roles)
    VALUES (${params.workflowId}, ${params.sequence}, ${params.role}, ${params.requiredCount}, ${params.eligibleRoles})
    ON CONFLICT (workflow_id, sequence, role) DO UPDATE SET
      required_count = EXCLUDED.required_count, eligible_roles = EXCLUDED.eligible_roles
  `;
}

export async function getWorkflowForDisable(params: {
  tenantId: string;
  workflowId: string;
}): Promise<{ enabled: boolean; workspace_id: string | null; environment: string | null } | null> {
  if (!sql) return null;
  const rows = await sql<{ enabled: boolean; workspace_id: string | null; environment: string | null }[]>`
    SELECT enabled, workspace_id, environment
    FROM approval_workflow_config
    WHERE id = ${params.workflowId} AND tenant_id = ${params.tenantId} LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function countEnabledWorkflows(tenantId: string): Promise<number> {
  if (!sql) return 0;
  const rows = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM approval_workflow_config
    WHERE tenant_id = ${tenantId} AND enabled = true
  `;
  return rows[0]?.count ?? 0;
}

export async function disableWorkflowById(params: {
  tenantId: string;
  workflowId: string;
  actorId: string;
}): Promise<string | null> {
  if (!sql) return null;
  const rows = await sql<{ workspace_id: string | null }[]>`
    UPDATE approval_workflow_config
    SET enabled = false, updated_by = ${params.actorId}, updated_at = now()
    WHERE id = ${params.workflowId} AND tenant_id = ${params.tenantId}
    RETURNING workspace_id
  `;
  return rows[0]?.workspace_id ?? null;
}

export async function getWorkflowScopeById(params: {
  tenantId: string;
  workflowId: string;
}): Promise<{ workspace_id: string | null; environment: string | null } | null> {
  if (!sql) return null;
  const rows = await sql<{ workspace_id: string | null; environment: string | null }[]>`
    SELECT workspace_id, environment FROM approval_workflow_config
    WHERE id = ${params.workflowId} AND tenant_id = ${params.tenantId} LIMIT 1
  `;
  return rows[0] ?? null;
}

const ALLOW_IMMEDIATE_PACK_PUBLISH_TAG = "pack:allow-immediate-publish";

export async function workspaceAllowsImmediatePackPublish(params: {
  tenantId: string;
  workspaceId: string;
}): Promise<boolean> {
  if (!sql) return false;
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM approval_workflow_config
      WHERE tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId}
        AND enabled = true
        AND ${ALLOW_IMMEDIATE_PACK_PUBLISH_TAG} = ANY(risk_tags)
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

export async function deleteWorkflowRuleById(params: {
  tenantId: string;
  workflowId: string;
  ruleId: string;
}): Promise<void> {
  if (!sql) return;
  await sql`
    DELETE FROM approval_workflow_rule
    WHERE id = ${params.ruleId} AND workflow_id = ${params.workflowId}
      AND EXISTS (
        SELECT 1 FROM approval_workflow_config aw
        WHERE aw.id = ${params.workflowId} AND aw.tenant_id = ${params.tenantId}
      )
  `;
}
