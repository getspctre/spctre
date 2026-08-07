-- F1/F2 provenance is distinct from semantic artifact_hash and AGT version
-- columns: it identifies the exact verifier closure and exact bytes checked.

ALTER TABLE public.agt_verification_result
  ADD COLUMN IF NOT EXISTS verifier_lock_digest text,
  ADD COLUMN IF NOT EXISTS policy_content_hash text;

ALTER TABLE public.agt_verification_result
  ADD CONSTRAINT agt_verification_result_verifier_lock_digest_check
  CHECK (verifier_lock_digest IS NULL OR verifier_lock_digest ~ '^sha256:[0-9a-f]{64}$') NOT VALID;

ALTER TABLE public.agt_verification_result
  ADD CONSTRAINT agt_verification_result_policy_content_hash_check
  CHECK (policy_content_hash IS NULL OR policy_content_hash ~ '^sha256:[0-9a-f]{64}$') NOT VALID;

CREATE INDEX IF NOT EXISTS agt_verification_result_provenance_idx
  ON public.agt_verification_result (tenant_id, revision_id, verifier_lock_digest, policy_content_hash, created_at DESC);
