CREATE TABLE IF NOT EXISTS gateway_escalation_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  gateway_decision_id uuid NOT NULL REFERENCES gateway_decision(id) ON DELETE CASCADE,
  decision_id text NOT NULL,
  revision_id uuid REFERENCES policy_revision(id) ON DELETE SET NULL,
  artifact_hash text NOT NULL,
  status text NOT NULL,
  assigned_to text,
  sla_due_at timestamptz NOT NULL,
  handoff_notes text,
  resolved_at timestamptz,
  resolution_outcome text,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  agent_guidance text,
  CONSTRAINT gateway_escalation_queue_tenant_id_decision_id_key UNIQUE (tenant_id, decision_id),
  CONSTRAINT gateway_escalation_queue_resolution_outcome_check CHECK (resolution_outcome IN ('PROCEED', 'ESCALATE', 'ABORT')),
  CONSTRAINT gateway_escalation_queue_status_check CHECK (status IN ('PENDING', 'IN_REVIEW', 'RESOLVED', 'EXPIRED'))
);

ALTER TABLE gateway_escalation_queue
  ADD COLUMN IF NOT EXISTS agt_request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS gateway_escalation_queue_agt_request_id_idx
  ON gateway_escalation_queue (tenant_id, agt_request_id)
  WHERE agt_request_id IS NOT NULL;

ALTER TABLE gateway_escalation_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON gateway_escalation_queue;
CREATE POLICY tenant_isolation ON gateway_escalation_queue
  TO spctre_app
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON gateway_escalation_queue TO spctre_app;
