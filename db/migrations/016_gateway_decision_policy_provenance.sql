-- Records which policy artifact was enforced and which evaluator interpreted
-- it, so a gateway decision stays reproducible after the kernel is upgraded.
--
-- gateway_decision.artifact_hash is the caller-supplied runtime policy context
-- and is part of the row's conflict key; it does not identify the composed,
-- published artifact the kernel actually evaluated. These columns do.
--
-- The bounded decision trace is intentionally not stored here: it is
-- regenerable by replaying the recorded artifact through the recorded evaluator
-- version, and it grows with rule count.

ALTER TABLE public.gateway_decision
  ADD COLUMN IF NOT EXISTS policy_artifact_hash text,
  ADD COLUMN IF NOT EXISTS policy_evaluator_version text;

ALTER TABLE public.gateway_decision
  DROP CONSTRAINT IF EXISTS gateway_decision_policy_artifact_hash_check;
ALTER TABLE public.gateway_decision
  ADD CONSTRAINT gateway_decision_policy_artifact_hash_check
  CHECK (policy_artifact_hash IS NULL OR policy_artifact_hash ~ '^sha256:[0-9a-f]{64}$') NOT VALID;

-- Supports "which decisions did this published artifact produce", the read an
-- audit or replay starts from.
CREATE INDEX IF NOT EXISTS gateway_decision_policy_artifact_idx
  ON public.gateway_decision (tenant_id, policy_artifact_hash, evaluated_at DESC)
  WHERE policy_artifact_hash IS NOT NULL;
