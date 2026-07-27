// Gateway-decision, runtime-evidence, and simulation demo seeding, plus the
// shared governance pack refs. Extracted from local-dev.ts (Phase 2 split).
import { randomUUID, createHash } from "crypto";
import { logger } from "@spctre/platform/logging";
import { DEMO_TENANT_ID, DEMO_WORKSPACE_ID } from "@/lib/demo";
import { sql } from "@/lib/db";

export interface GovernancePackRefs {
  revisionId: string | null;
  branchId: string | null;
  artifactHash: string;
}

export async function resolveGovernancePackRefs(): Promise<GovernancePackRefs> {
  let revisionId: string | null = null;
  let branchId: string | null = null;
  let artifactHash = "sha256:spctre-demo-hash";
  if (!sql) return { revisionId, branchId, artifactHash };

  try {
    const governancePack = await sql<{ branch_id: string; active_revision_id: string; artifact_hash: string }[]>`
      SELECT pb.id AS branch_id, pb.active_revision_id, pr.artifact_hash
      FROM policy_branch pb
      LEFT JOIN policy_revision pr ON pr.id = pb.active_revision_id AND pr.tenant_id = pb.tenant_id
      WHERE pb.tenant_id = ${DEMO_TENANT_ID}
        AND pb.workspace_id = ${DEMO_WORKSPACE_ID}
        AND pb.scope = 'CONNECTOR'
        AND pb.connector = 'spctre-agent'
      LIMIT 1
    `;
    const pack = governancePack[0];
    if (pack) {
      branchId = pack.branch_id;
      revisionId = pack.active_revision_id;
      artifactHash = pack.artifact_hash ?? "sha256:spctre-demo-hash";
    }
  } catch (err) {
    logger.warn("Could not retrieve active governance pack info", { error: err });
  }

  return { revisionId, branchId, artifactHash };
}

// 4. Seed gateway decisions and escalations (with median assignee delay)
export async function seedGatewayDecisionsAndEscalations({ revisionId, branchId, artifactHash }: GovernancePackRefs) {
  if (!sql) return;

  try {
    const decisions = await sql<{ id: string; decision_id: string }[]>`
      INSERT INTO gateway_decision (
        tenant_id, workspace_id, decision_id, revision_id, branch_id, artifact_hash,
        outcome, reason, consequence, customer_tier, confidence, amount_usd,
        data_sensitivity, trust_score, context_budget, risk_level, evaluated_by,
        evaluated_at, created_at
      ) VALUES
        (
          ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, 'dec-stripe-001', ${revisionId}, ${branchId}, ${artifactHash},
          'ESCALATE', 'Billing transfer exceeded standard limits under high consequence constraints', 'TRANSFER_HOLD', 'ENTERPRISE', 0.92000, 15000.00,
          'HIGH', 0.82000, 3200, 'HIGH', 'agent-billing-prod',
          now() - interval '4 hours', now() - interval '4 hours'
        ),
        (
          ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, 'dec-stripe-002', ${revisionId}, ${branchId}, ${artifactHash},
          'ESCALATE', 'Refund requested for unverified user account', 'REFUND_HOLD', 'COMMUNITY', 0.78000, 250.00,
          'MEDIUM', 0.74000, 1800, 'MEDIUM', 'agent-billing-prod',
          now() - interval '2 hours', now() - interval '2 hours'
        ),
        (
          ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, 'dec-stripe-003', ${revisionId}, ${branchId}, ${artifactHash},
          'ESCALATE', 'Multiple rapid subscription state transitions observed', 'ACCOUNT_LOCK', 'BUSINESS', 0.81000, 0.00,
          'LOW', 0.79000, 4500, 'HIGH', 'agent-billing-prod',
          now() - interval '1 hour', now() - interval '1 hour'
        )
      RETURNING id, decision_id
    `;

    const dec0 = decisions.find((d) => d.decision_id === 'dec-stripe-001')?.id;
    const dec1 = decisions.find((d) => d.decision_id === 'dec-stripe-002')?.id;
    const dec2 = decisions.find((d) => d.decision_id === 'dec-stripe-003')?.id;

    if (dec0 && dec1 && dec2) {
      await sql`
        INSERT INTO gateway_escalation_queue (
          tenant_id, workspace_id, gateway_decision_id, decision_id, revision_id, artifact_hash,
          status, assigned_to, sla_due_at, handoff_notes, created_at, updated_at, resolved_at,
          resolution_outcome, resolution_note
        ) VALUES
          (
            ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, ${dec0}, 'dec-stripe-001', ${revisionId}, ${artifactHash},
            'RESOLVED', 'maya@spctre.local', now() + interval '20 hours', 'Escalated billing limit boundary exception.',
            now() - interval '4 hours', now() - interval '4 hours' + interval '5 minutes', now() - interval '4 hours' + interval '5 minutes',
            'PROCEED', 'Approved manually after checking stripe balance.'
          ),
          (
            ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, ${dec1}, 'dec-stripe-002', ${revisionId}, ${artifactHash},
            'RESOLVED', 'lee@spctre.local', now() + interval '22 hours', 'Escalated refund anomaly for unverified user.',
            now() - interval '2 hours', now() - interval '2 hours' + interval '8 minutes', now() - interval '2 hours' + interval '8 minutes',
            'ABORT', 'Denied refund. Suspicious traffic pattern confirmed.'
          ),
          (
            ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, ${dec2}, 'dec-stripe-003', ${revisionId}, ${artifactHash},
            'RESOLVED', 'nora@spctre.local', now() + interval '23 hours', 'Escalated rapid state changes.',
            now() - interval '1 hour', now() - interval '1 hour' + interval '15 minutes', now() - interval '1 hour' + interval '15 minutes',
            'PROCEED', 'Resolved. User completed verification flow successfully.'
          )
      `;
    }
  } catch (err) {
    logger.error("Failed to seed gateway decisions and escalations", { error: err });
  }
}

// 5. Seed time-partitioned runtime evidence events
export async function seedRuntimeEvidenceEvents({ revisionId, branchId, artifactHash }: GovernancePackRefs) {
  if (!sql) return;

  try {
    await sql`SELECT spctre_ensure_runtime_evidence_partitions(2, 6)`;
  } catch {
    // partition function may not exist yet
  }

  try {
    const currentEvents = [
      { decisionId: 'ev-cur-001', status: 'ALLOW', action: 'read_user', agentId: 'agent-support-prod', connector: 'aws-bedrock', reason: 'Prompt approved by safeguard' },
      { decisionId: 'ev-cur-002', status: 'ALLOW', action: 'write_file', agentId: 'agent-support-prod', connector: 'aws-bedrock', reason: 'Valid sandbox file write' },
      { decisionId: 'ev-cur-003', status: 'ALLOW', action: 'list_buckets', agentId: 'agent-support-prod', connector: 'aws-bedrock', reason: 'Public bucket access' },
      { decisionId: 'ev-cur-004', status: 'ALLOW', action: 'read_invoice', agentId: 'agent-billing-prod', connector: 'stripe', reason: 'Read billing history allowable limit' },
      { decisionId: 'ev-cur-005', status: 'ALLOW', action: 'create_customer', agentId: 'agent-billing-prod', connector: 'stripe', reason: 'Safe customer registration' },
      { decisionId: 'ev-cur-006', status: 'ALLOW', action: 'read_pr', agentId: 'agent-deploy-prod', connector: 'github', reason: 'Read-only PR info fetch' },
      { decisionId: 'ev-cur-007', status: 'ALLOW', action: 'merge_pr', agentId: 'agent-deploy-prod', connector: 'github', reason: 'Approved merge workflow' },
      { decisionId: 'ev-cur-008', status: 'ALLOW', action: 'list_repos', agentId: 'agent-deploy-prod', connector: 'github', reason: 'Public repository list' },
      { decisionId: 'ev-cur-009', status: 'WARN', action: 'delete_invoice', agentId: 'agent-billing-prod', connector: 'stripe', reason: 'High friction operation warn threshold' },
      { decisionId: 'ev-cur-010', status: 'DENY', action: 'delete_branch', agentId: 'agent-deploy-prod', connector: 'github', reason: 'Blocked branch deletion check' }
    ];

    const prevEvents = [
      { decisionId: 'ev-prev-001', status: 'ALLOW', action: 'read_user', agentId: 'agent-support-prod', connector: 'aws-bedrock', reason: 'Prompt check' },
      { decisionId: 'ev-prev-002', status: 'ALLOW', action: 'write_file', agentId: 'agent-support-prod', connector: 'aws-bedrock', reason: 'Sandbox check' },
      { decisionId: 'ev-prev-003', status: 'ALLOW', action: 'read_invoice', agentId: 'agent-billing-prod', connector: 'stripe', reason: 'Invoicing' },
      { decisionId: 'ev-prev-004', status: 'ALLOW', action: 'create_customer', agentId: 'agent-billing-prod', connector: 'stripe', reason: 'Customer check' },
      { decisionId: 'ev-prev-005', status: 'ALLOW', action: 'read_pr', agentId: 'agent-deploy-prod', connector: 'github', reason: 'PR check' },
      { decisionId: 'ev-prev-006', status: 'ALLOW', action: 'list_repos', agentId: 'agent-deploy-prod', connector: 'github', reason: 'Repository check' },
      { decisionId: 'ev-prev-007', status: 'WARN', action: 'list_buckets', agentId: 'agent-support-prod', connector: 'aws-bedrock', reason: 'Unusual bucket scanning' },
      { decisionId: 'ev-prev-008', status: 'WARN', action: 'delete_invoice', agentId: 'agent-billing-prod', connector: 'stripe', reason: 'High friction' },
      { decisionId: 'ev-prev-009', status: 'DENY', action: 'merge_pr', agentId: 'agent-deploy-prod', connector: 'github', reason: 'Blocked merge' },
      { decisionId: 'ev-prev-010', status: 'DENY', action: 'delete_branch', agentId: 'agent-deploy-prod', connector: 'github', reason: 'Blocked branch deletion' }
    ];

    const insertEvent = async (ev: typeof currentEvents[0], daysAgo: number) => {
      const db = sql!;
      const id = randomUUID();
      const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      const hash = "sha256:" + createHash("sha256").update(ev.decisionId).digest("hex");

      await db.begin(async (tx) => {
        const claimed = await tx<{ decision_id: string }[]>`
          INSERT INTO runtime_evidence_event_key (tenant_id, decision_id)
          VALUES (${DEMO_TENANT_ID}, ${ev.decisionId})
          ON CONFLICT (tenant_id, decision_id) DO NOTHING
          RETURNING decision_id
        `;
        if (claimed.length === 0) return;

        await tx`
          INSERT INTO runtime_evidence_event (
            id, decision_id, tenant_id, workspace_id, environment, runtime_stack, runtime_adapter,
            agent_id, connector, action, status, reason, policy_refs, artifact_hash,
            policy_context, raw_evidence, latency_ms, created_at, evidence_content_hash, evidence_prev_hash
          ) VALUES (
            ${id}, ${ev.decisionId}, ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, 'production', 'CUSTOM', 'spctre-demo',
            ${ev.agentId}, ${ev.connector}, ${ev.action}, ${ev.status}, ${ev.reason},
            ARRAY['spctre-agent-governance-v1']::text[], ${artifactHash},
            ${JSON.stringify([{ revisionId, branchId, packId: 'spctre-agent-governance-v1' }])}::jsonb,
            ${JSON.stringify({ details: ev.reason })}::jsonb, 120, ${createdAt}, ${hash}, null
          )
        `;

        await tx`
          UPDATE runtime_evidence_event_key
          SET evidence_event_id = ${id}, evidence_created_at = ${createdAt}
          WHERE tenant_id = ${DEMO_TENANT_ID} AND decision_id = ${ev.decisionId}
        `;
      });
    };

    for (const ev of currentEvents) {
      await insertEvent(ev, 5);
    }
    for (const ev of prevEvents) {
      await insertEvent(ev, 40);
    }

  } catch (err) {
    logger.error("Failed to seed runtime evidence events", { error: err });
  }
}

// 5b. Seed simulation runs
export async function seedSimulationRuns({ revisionId, branchId }: GovernancePackRefs) {
  if (!sql) return;

  try {
    if (branchId && revisionId) {
      await sql`
        INSERT INTO simulation_run (
          tenant_id, workspace_id, branch_id, revision_id,
          source_event_count, newly_denied_count, newly_allowed_count, unchanged_count, created_by, created_at
        ) VALUES
          (
            ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, ${branchId}, ${revisionId},
            120, 4, 1, 115, 'maya@spctre.local', now() - interval '3 days'
          ),
          (
            ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, ${branchId}, ${revisionId},
            85, 0, 2, 83, 'lee@spctre.local', now() - interval '1 day'
          ),
          (
            ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, ${branchId}, ${revisionId},
            210, 12, 0, 198, 'nora@spctre.local', now() - interval '4 hours'
          )
      `;
    }
  } catch (err) {
    logger.error("Failed to seed simulation runs", { error: err });
  }
}
