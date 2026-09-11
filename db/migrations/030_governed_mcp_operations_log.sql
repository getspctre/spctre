-- Record registry and grant changes in the operations log.
--
-- Approving an MCP tool for a workspace or an agent decides what a governed
-- runtime may do, which makes it a governance act rather than configuration.
-- The three event types below are what the operations log needs to carry it.
--
-- The write path they audit is new (see lib/domains/mcp/service.ts). Until it
-- existed, mcp_tool_registry and mcp_tool_grant had a read path and nothing
-- else, so every workspace answered DENY to every third-party tool.
--
-- Widening only. The full list is restated because the constraint is replaced
-- rather than amended, which is the same shape as 017 and 019; no existing row
-- can violate the result.

ALTER TABLE public.agt_operations_log
  DROP CONSTRAINT IF EXISTS agt_operations_log_event_type_check;

ALTER TABLE public.agt_operations_log
  ADD CONSTRAINT agt_operations_log_event_type_check CHECK (
    event_type = ANY (ARRAY[
      'POLICY_IMPORT', 'POLICY_PUBLISH', 'POLICY_APPROVE',
      'BLUEPRINT_APPROVE', 'BLUEPRINT_PUBLISH', 'BLUEPRINT_ROLLBACK',
      'EVIDENCE_INGEST', 'EVIDENCE_EXPORT', 'BUNDLE_EXPORT',
      'EVIDENCE_PRUNE', 'EVIDENCE_ERASURE', 'SIMULATION_RUN',
      'TRUST_SCORE_CHANGE', 'TRUST_POLICY_BREACH', 'CONTEXT_BUDGET_BREACH',
      'ECONOMIC_BUDGET_BREACH', 'ECONOMIC_USAGE_INGEST', 'IDENTITY_CHANGE',
      'TOKEN_ISSUED', 'TOKEN_REVOKED', 'TOKEN_REFRESHED',
      'ESCALATION_OPENED', 'ESCALATION_CLAIMED', 'ESCALATION_RESOLVED',
      'AGENT_TRIAGE', 'AGENT_RECOMMENDATION', 'SIMULATION_GUIDANCE',
      'GRC_DESTINATION_CONFIGURED', 'NOTIFICATION_SENT', 'NOTIFICATION_FAILED',
      'VERIFICATION_RUN', 'ACTION_RECEIPT_ISSUED', 'COMPLIANCE_EXPORT',
      'GATEWAY_DECISION_REPLAY_DIVERGED', 'USAGE_RECONCILED',
      'MCP_TOOL_REGISTERED', 'MCP_TOOL_GRANTED', 'MCP_TOOL_REVOKED'
    ]::text[])
  );
