ALTER TABLE gateway_escalation_queue
  ADD COLUMN IF NOT EXISTS agt_request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS gateway_escalation_queue_agt_request_id_idx
  ON gateway_escalation_queue (tenant_id, agt_request_id)
  WHERE agt_request_id IS NOT NULL;
