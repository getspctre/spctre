import { POLICY_RULE_COLUMNS, toPolicyRuleRows } from "@/lib/repositories/policy/rule-rows";
import { logger } from "@spctre/platform/logging";
import { randomUUID } from "crypto";
import type { JSONValue } from "postgres";
import { computeShortHash } from "@spctre/platform";
import { sql } from "@/lib/db";
import { getLatestPublishedBundle } from "@/lib/repositories/policy";
import { listActiveApiKeys } from "@/lib/repositories/auth/service-keys";
import type { ServiceTokenScope } from "@/lib/service-tokens";
import { swallow } from "@/lib/platform/swallow";

export const ONBOARDING_TTL_MINUTES = 10;
const STARTER_BRANCH_NAME = "starter/runtime-onboarding";
export const WEB_ONBOARDING_TOKEN_LABEL = "Spctre web onboarding setup";
export const WEB_ONBOARDING_TOKEN_SCOPES: ServiceTokenScope[] = [
  "bundle:read",
  "decision:evaluate",
  "evidence:write",
  "heartbeat:write",
];
export const WEB_ONBOARDING_MILESTONES = [
  "starter_policy_published",
  "sample_decision_sent",
  "setup_token_generated",
  "gateway_test_sent",
  "first_real_evidence_received",
  "onboarding_completed",
] as const;

export type WebOnboardingMilestone = (typeof WEB_ONBOARDING_MILESTONES)[number];

type WebOnboardingMilestoneMap = Record<WebOnboardingMilestone, boolean>;

const EMPTY_WEB_ONBOARDING_MILESTONES: WebOnboardingMilestoneMap = Object.fromEntries(
  WEB_ONBOARDING_MILESTONES.map((milestone) => [milestone, false]),
) as WebOnboardingMilestoneMap;

export const STARTER_POLICY_RULES = [
  {
    stableRuleId: "system.heartbeat",
    title: "Accept runtime heartbeats from connected agents",
    effect: "ALLOW",
    sourceFormat: "AGT_YAML",
    sourcePath: "spctre-starter.yaml",
    domains: ["operations"],
    connectors: ["system"],
    actions: ["heartbeat"],
    immutable: false,
  },
  {
    stableRuleId: "sample.event.allow",
    title: "Allow sample onboarding events",
    effect: "ALLOW",
    sourceFormat: "AGT_YAML",
    sourcePath: "spctre-starter.yaml",
    domains: ["onboarding"],
    connectors: ["sample"],
    actions: ["event.register"],
    immutable: false,
  },
  {
    stableRuleId: "sample.payment.block",
    title: "Block high-risk payment actions (sample)",
    effect: "DENY",
    sourceFormat: "AGT_YAML",
    sourcePath: "spctre-starter.yaml",
    domains: ["finance"],
    connectors: ["sample"],
    actions: ["payment.create"],
    immutable: false,
  },
] as const;

export function slugifyWorkspace(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export async function ensureStarterPublishedBundle(params: {
  tenantId: string;
  workspaceId: string;
  actorId: string;
  environment: string;
}) {
  const existing = await getLatestPublishedBundle(params.workspaceId, params.tenantId);
  if (existing) {
    await recordWebOnboardingMilestone({
      tenantId: params.tenantId,
      workspaceId: params.workspaceId,
      milestone: "starter_policy_published",
      metadata: {
        source: "existing_bundle",
        branchId: existing.branchId,
        revisionId: existing.revisionId,
        artifactHash: existing.artifactHash,
      },
    });
    return {
      branchId: existing.branchId,
      revisionId: existing.revisionId,
      artifactHash: existing.artifactHash,
    };
  }

  if (!sql) throw new Error("Database not configured.");

  const branchId = randomUUID();
  const revisionId = randomUUID();
  const rules = STARTER_POLICY_RULES;
  const sourceDocument = { kind: "spctre.starter_policy", rules };
  const sourceHash = computeShortHash(JSON.stringify(sourceDocument));
  const artifactHash = computeShortHash(
    `${params.tenantId}:${params.workspaceId}:${revisionId}:starter`,
  );

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO policy_branch (
        id, tenant_id, workspace_id, scope, environment, connector, name, created_by
      ) VALUES (
        ${branchId}, ${params.tenantId}, ${params.workspaceId},
        'WORKSPACE', NULL, NULL, ${STARTER_BRANCH_NAME}, ${params.actorId}
      )
    `;

    await tx`
      INSERT INTO policy_revision (
        id, tenant_id, workspace_id, branch_id, source_format, source_path,
        source_document, source_hash, artifact_hash, target_stacks, author_id, message
      ) VALUES (
        ${revisionId}, ${params.tenantId}, ${params.workspaceId}, ${branchId},
        'AGT_YAML', 'spctre-starter.yaml', ${sql.json(sourceDocument as JSONValue)},
        ${sourceHash}, ${artifactHash},
        ${sql.json([{ stack: "LOCAL", adapter: "spctre-cli", environment: params.environment }])}::jsonb,
        ${params.actorId}, 'Starter policy — auto-published on first workspace setup'
      )
    `;

    await tx`
      INSERT INTO policy_rule ${tx(
        toPolicyRuleRows({
          tenantId: params.tenantId,
          workspaceId: params.workspaceId,
          branchId,
          revisionId,
          rules,
        }),
        ...POLICY_RULE_COLUMNS,
      )}
    `;

    await tx`
      UPDATE policy_branch
      SET active_revision_id = ${revisionId}
      WHERE id = ${branchId}
    `;

    await tx`
      INSERT INTO policy_publish (
        tenant_id, workspace_id, branch_id, revision_id,
        environment, runtime_stack, runtime_adapter, artifact_hash, published_by
      ) VALUES (
        ${params.tenantId}, ${params.workspaceId}, ${branchId}, ${revisionId},
        ${params.environment}, 'LOCAL', 'spctre-cli', ${artifactHash}, ${params.actorId}
      )
    `;
  });

  await recordWebOnboardingMilestone({
    tenantId: params.tenantId,
    workspaceId: params.workspaceId,
    milestone: "starter_policy_published",
    metadata: { source: "starter_bundle", branchId, revisionId, artifactHash },
  });

  return { branchId, revisionId, artifactHash };
}

export async function recordWebOnboardingMilestone(params: {
  tenantId: string;
  workspaceId: string;
  milestone: WebOnboardingMilestone;
  metadata?: Record<string, unknown>;
}) {
  if (!sql) return;

  try {
    await sql`
      INSERT INTO web_onboarding_milestone (
        tenant_id, workspace_id, milestone, metadata
      ) VALUES (
        ${params.tenantId}, ${params.workspaceId}, ${params.milestone},
        ${sql.json((params.metadata ?? {}) as JSONValue)}::jsonb
      )
      ON CONFLICT (tenant_id, workspace_id, milestone)
      DO UPDATE SET
        metadata = web_onboarding_milestone.metadata || EXCLUDED.metadata
    `;
  } catch (err) {
    logger.warn("[web-onboarding] milestone persistence failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function listWebOnboardingMilestones(params: {
  tenantId: string;
  workspaceId: string;
}): Promise<WebOnboardingMilestoneMap> {
  if (!sql) return { ...EMPTY_WEB_ONBOARDING_MILESTONES };

  try {
    const rows = await sql<{ milestone: WebOnboardingMilestone }[]>`
      SELECT milestone
      FROM web_onboarding_milestone
      WHERE tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId}
    `;
    const milestones = { ...EMPTY_WEB_ONBOARDING_MILESTONES };
    for (const row of rows) milestones[row.milestone] = true;
    return milestones;
  } catch {
    return { ...EMPTY_WEB_ONBOARDING_MILESTONES };
  }
}

export interface WebOnboardingStatus {
  quickStartEvidenceCount: number;
  realEvidenceCount: number;
  latestRealEvidenceId: string | null;
  setupTokenExists: boolean;
  setupTokenPrefix: string | null;
  milestones: WebOnboardingMilestoneMap;
  publishedBundle: { branchId: string; revisionId: string; artifactHash: string } | null;
}

// Record any milestones that the observed workspace state implies but that
// were never explicitly recorded (idempotent reconciliation).
async function reconcileWebOnboardingMilestones(
  params: { tenantId: string; workspaceId: string },
  observed: {
    publishedBundle: { branchId: string; revisionId: string; artifactHash: string } | null;
    quickStartEvidenceCount: number;
    setupToken: { tokenPrefix: string } | null;
    gatewayDecisionCount: number;
    realEvidenceCount: number;
    latestRealEvidenceId: string | null;
  },
): Promise<void> {
  const scope = { tenantId: params.tenantId, workspaceId: params.workspaceId };
  const tasks: Promise<unknown>[] = [];

  if (observed.publishedBundle) {
    tasks.push(
      recordWebOnboardingMilestone({
        ...scope,
        milestone: "starter_policy_published",
        metadata: {
          source: "status_reconciliation",
          branchId: observed.publishedBundle.branchId,
          revisionId: observed.publishedBundle.revisionId,
          artifactHash: observed.publishedBundle.artifactHash,
        },
      }),
    );
  }
  if (observed.quickStartEvidenceCount > 0) {
    tasks.push(
      recordWebOnboardingMilestone({
        ...scope,
        milestone: "sample_decision_sent",
        metadata: { source: "status_reconciliation" },
      }),
    );
  }
  if (observed.setupToken) {
    tasks.push(
      recordWebOnboardingMilestone({
        ...scope,
        milestone: "setup_token_generated",
        metadata: { source: "status_reconciliation", tokenPrefix: observed.setupToken.tokenPrefix },
      }),
    );
  }
  if (observed.gatewayDecisionCount > 0) {
    tasks.push(
      recordWebOnboardingMilestone({
        ...scope,
        milestone: "gateway_test_sent",
        metadata: { source: "status_reconciliation" },
      }),
    );
  }
  if (observed.realEvidenceCount > 0) {
    tasks.push(
      recordWebOnboardingMilestone({
        ...scope,
        milestone: "first_real_evidence_received",
        metadata: {
          source: "status_reconciliation",
          latestDecisionId: observed.latestRealEvidenceId,
        },
      }),
    );
    tasks.push(
      recordWebOnboardingMilestone({
        ...scope,
        milestone: "onboarding_completed",
        metadata: { source: "status_reconciliation" },
      }),
    );
  }

  await Promise.all(tasks);
}

export async function getWebOnboardingStatus(params: {
  tenantId: string;
  workspaceId: string;
}): Promise<WebOnboardingStatus> {
  if (!sql) {
    return {
      quickStartEvidenceCount: 0,
      realEvidenceCount: 0,
      latestRealEvidenceId: null,
      setupTokenExists: false,
      setupTokenPrefix: null,
      milestones: { ...EMPTY_WEB_ONBOARDING_MILESTONES },
      publishedBundle: null,
    };
  }

  const [evidenceRows, latestRealRows, gatewayRows, keys, publishedBundle] = await Promise.all([
    sql<{ quickstart_count: string; real_count: string }[]>`
      SELECT
        COUNT(*) FILTER (
          WHERE COALESCE(raw_evidence->>'_source', raw_evidence->>'source', '') = 'quickstart'
        )::text AS quickstart_count,
        COUNT(*) FILTER (
          WHERE COALESCE(raw_evidence->>'_source', raw_evidence->>'source', '') <> 'quickstart'
        )::text AS real_count
      FROM runtime_evidence_event
      WHERE tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId}
    `,
    sql<{ decision_id: string }[]>`
      SELECT decision_id
      FROM runtime_evidence_event
      WHERE tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId}
        AND COALESCE(raw_evidence->>'_source', raw_evidence->>'source', '') <> 'quickstart'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    sql<{ gateway_count: string }[]>`
      SELECT COUNT(*)::text AS gateway_count
      FROM gateway_decision
      WHERE tenant_id = ${params.tenantId}
        AND workspace_id = ${params.workspaceId}
    `.catch(swallow("sql", [{ gateway_count: "0" }])),
    listActiveApiKeys(params.tenantId, params.workspaceId).catch(
      swallow("listActiveApiKeys", null),
    ),
    getLatestPublishedBundle(params.workspaceId, params.tenantId).catch(
      swallow("getLatestPublishedBundle", null),
    ),
  ]);

  const setupToken = keys?.find((key) => key.label === WEB_ONBOARDING_TOKEN_LABEL) ?? null;
  const quickStartEvidenceCount = parseInt(evidenceRows[0]?.quickstart_count ?? "0", 10);
  const realEvidenceCount = parseInt(evidenceRows[0]?.real_count ?? "0", 10);
  const gatewayDecisionCount = parseInt(gatewayRows[0]?.gateway_count ?? "0", 10);

  await reconcileWebOnboardingMilestones(params, {
    publishedBundle,
    quickStartEvidenceCount,
    setupToken,
    gatewayDecisionCount,
    realEvidenceCount,
    latestRealEvidenceId: latestRealRows[0]?.decision_id ?? null,
  });

  return {
    quickStartEvidenceCount,
    realEvidenceCount,
    latestRealEvidenceId: latestRealRows[0]?.decision_id ?? null,
    setupTokenExists: Boolean(setupToken),
    setupTokenPrefix: setupToken?.tokenPrefix ?? null,
    milestones: await listWebOnboardingMilestones(params),
    publishedBundle: publishedBundle
      ? {
          branchId: publishedBundle.branchId,
          revisionId: publishedBundle.revisionId,
          artifactHash: publishedBundle.artifactHash,
        }
      : null,
  };
}
