-- Generic lifecycle fields for every verification producer. The historical
-- table name is retained for compatibility; CUSTOM verification runs use these
-- fields without any AGT dependency.

ALTER TABLE public.agt_verification_result
  ADD COLUMN IF NOT EXISTS verifier_id text,
  ADD COLUMN IF NOT EXISTS verifier_digest text,
  ADD COLUMN IF NOT EXISTS stale_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS stale_reasons text[] NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE public.agt_verification_result
  ADD CONSTRAINT agt_verification_result_verifier_digest_check
  CHECK (verifier_digest IS NULL OR verifier_digest ~ '^sha256:[0-9a-f]{64}$') NOT VALID;

CREATE INDEX IF NOT EXISTS agt_verification_result_lifecycle_idx
  ON public.agt_verification_result
  (tenant_id, workspace_id, revision_id, verifier_id, created_at DESC);
