-- Preserve the governed connector/action on the decision itself. Runtime
-- evidence is supplementary audit data and is not guaranteed to exist when a
-- reviewer or runtime client reads an escalation.
ALTER TABLE public.gateway_decision
  ADD COLUMN IF NOT EXISTS connector text,
  ADD COLUMN IF NOT EXISTS action text;

COMMENT ON COLUMN public.gateway_decision.connector IS
  'Connector supplied at gateway decision time; retained independently of runtime evidence.';
COMMENT ON COLUMN public.gateway_decision.action IS
  'Action supplied at gateway decision time; retained independently of runtime evidence.';

-- Recover the values for historical decisions that have an evidence event.
-- Decisions without evidence cannot be reconstructed retrospectively; new
-- decision-time writes below keep that gap from recurring.
WITH latest_evidence AS (
  SELECT DISTINCT ON (tenant_id, workspace_id, decision_id, artifact_hash)
    tenant_id,
    workspace_id,
    decision_id,
    artifact_hash,
    connector,
    action
  FROM public.runtime_evidence_event
  ORDER BY tenant_id, workspace_id, decision_id, artifact_hash, created_at DESC
)
UPDATE public.gateway_decision AS gd
SET
  connector = latest_evidence.connector,
  action = latest_evidence.action
FROM latest_evidence
WHERE gd.tenant_id = latest_evidence.tenant_id
  AND gd.workspace_id = latest_evidence.workspace_id
  AND gd.decision_id = latest_evidence.decision_id
  AND gd.artifact_hash = latest_evidence.artifact_hash
  AND (gd.connector IS NULL OR gd.action IS NULL);
