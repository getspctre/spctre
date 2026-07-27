// Trust calibration policy / context-budget / trust-score demo seeding.
// Extracted from local-dev.ts (Phase 2 large-file split).
import { logger } from "@spctre/platform/logging";
import { DEMO_TENANT_ID, DEMO_WORKSPACE_ID } from "@/lib/demo";
import { sql } from "@/lib/db";

// 1. Seed trust calibration policies
export async function seedTrustCalibrationPolicies() {
  if (!sql) return;

  try {
    await sql`
      INSERT INTO trust_calibration_policy (
        id, tenant_id, workspace_id, name, description, enabled,
        agent_class, environment, connector, consequence_tier,
        decay_enabled, decay_rate, decay_period_hours, decay_floor,
        warn_threshold, escalate_threshold, review_threshold,
        context_warn_threshold, context_escalate_threshold, created_by
      ) VALUES
        (
          '00000000-0000-0000-0000-000000000101', ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID},
          'Stripe Consequence Boundary', 'Enforces strict trust score limits on billing and financial operations', true,
          'agent-billing', 'production', 'stripe', 'HIGH',
          false, null, null, 0.0,
          0.85000, 0.75000, 0.70000,
          4000, 8000, 'seed:local-dev'
        ),
        (
          '00000000-0000-0000-0000-000000000102', ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID},
          'AWS Bedrock Safeguard', 'Guardrails for foundation models and sensitive prompt scopes', true,
          'agent-support', 'production', 'aws-bedrock', 'MEDIUM',
          false, null, null, 0.0,
          0.70000, 0.60000, 0.50000,
          8000, 16000, 'seed:local-dev'
        ),
        (
          '00000000-0000-0000-0000-000000000103', ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID},
          'GitHub Deploy Governance', 'Validates deploy environments and branch review gates', true,
          'agent-deploy', 'production', 'github', 'CRITICAL',
          false, null, null, 0.0,
          0.90000, 0.80000, 0.75000,
          null, null, 'seed:local-dev'
        )
    `;
  } catch (err) {
    logger.error("Failed to seed trust calibration policies", { error: err });
  }
}

// 2. Seed context budget telemetry
export async function seedContextBudgetEvents() {
  if (!sql) return;

  try {
    await sql`
      INSERT INTO context_budget_event (
        tenant_id, workspace_id, session_id, agent_id, environment, runtime_stack,
        event_type, token_count, token_delta, context_source_mix, budget_limit,
        budget_utilization, governance_action, policy_ref, created_at
      ) VALUES
        (
          ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, 'session-support-01', 'agent-support-prod', 'production', 'CUSTOM',
          'TOKEN_GROWTH', 5000, 1200, '{"vector_store": 3000, "user_prompt": 1000, "history": 1000}'::jsonb, 8000,
          0.62500, 'ALLOW', '00000000-0000-0000-0000-000000000102', now() - interval '2 days'
        ),
        (
          ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, 'session-support-01', 'agent-support-prod', 'production', 'CUSTOM',
          'SUMMARIZATION_EVENT', 7500, 2500, '{"vector_store": 4000, "user_prompt": 1500, "history": 2000}'::jsonb, 8000,
          0.93750, 'WARN', '00000000-0000-0000-0000-000000000102', now() - interval '1 day'
        ),
        (
          ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, 'session-support-01', 'agent-support-prod', 'production', 'CUSTOM',
          'BUDGET_BREACH', 9000, 1500, '{"vector_store": 4500, "user_prompt": 2000, "history": 2500}'::jsonb, 8000,
          1.12500, 'ESCALATE', '00000000-0000-0000-0000-000000000102', now() - interval '12 hours'
        ),
        (
          ${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, 'session-billing-01', 'agent-billing-prod', 'production', 'CUSTOM',
          'TOKEN_GROWTH', 3500, 800, '{"api_metadata": 2000, "user_prompt": 800, "history": 700}'::jsonb, 4000,
          0.87500, 'WARN', '00000000-0000-0000-0000-000000000101', now() - interval '4 hours'
        )
    `;
  } catch (err) {
    logger.error("Failed to seed context budget events", { error: err });
  }
}

// 3. Seed trust score progression history
export async function seedTrustScoreEvents() {
  if (!sql) return;

  try {
    await sql`
      INSERT INTO agt_trust_score_event (
        tenant_id, workspace_id, agent_id, environment, runtime_stack,
        trust_score, previous_score, delta, source, reason, created_at
      ) VALUES
        -- support agent
        (${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, 'agent-support-prod', 'production', 'CUSTOM', 0.75000, null, null, 'SYSTEM', 'Initial score evaluation', now() - interval '5 days'),
        (${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, 'agent-support-prod', 'production', 'CUSTOM', 0.72000, 0.75000, -0.03000, 'EVIDENCE_INGEST', 'Model hallucination warn event', now() - interval '4 days'),
        (${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, 'agent-support-prod', 'production', 'CUSTOM', 0.68000, 0.72000, -0.04000, 'SYSTEM', 'Budget breach escalation', now() - interval '3 days'),
        (${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, 'agent-support-prod', 'production', 'CUSTOM', 0.82000, 0.68000, 0.14000, 'MANUAL', 'Manual calibration by operator Nora', now() - interval '2 days'),
        (${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, 'agent-support-prod', 'production', 'CUSTOM', 0.85000, 0.82000, 0.03000, 'POLICY_EVALUATION', 'Consistent policy conformance in execution window', now() - interval '1 day'),
        
        -- billing agent
        (${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, 'agent-billing-prod', 'production', 'CUSTOM', 0.95000, null, null, 'SYSTEM', 'Initial onboarding evaluation', now() - interval '5 days'),
        (${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, 'agent-billing-prod', 'production', 'CUSTOM', 0.94000, 0.95000, -0.01000, 'EVIDENCE_INGEST', 'Stripe API latency warning', now() - interval '3 days'),
        (${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, 'agent-billing-prod', 'production', 'CUSTOM', 0.96000, 0.94000, 0.02000, 'POLICY_EVALUATION', 'Completed compliance verification pass', now() - interval '1 day'),
        
        -- deploy agent
        (${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, 'agent-deploy-prod', 'production', 'CUSTOM', 0.90000, null, null, 'SYSTEM', 'Onboarding verification', now() - interval '4 days'),
        (${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, 'agent-deploy-prod', 'production', 'CUSTOM', 0.88000, 0.90000, -0.02000, 'SYSTEM', 'Minor drift detected in deploy rules', now() - interval '2 days'),
        (${DEMO_TENANT_ID}, ${DEMO_WORKSPACE_ID}, 'agent-deploy-prod', 'production', 'CUSTOM', 0.92000, 0.88000, 0.04000, 'POLICY_EVALUATION', 'Successful pre-production validation run', now() - interval '1 day')
    `;
  } catch (err) {
    logger.error("Failed to seed trust score events", { error: err });
  }
}
