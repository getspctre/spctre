-- Immutable, tenant-scoped custody for publication facts and the exact bytes
-- those facts describe. This store is intentionally separate from runtime
-- evidence: publication proof must not be removed by retained-event pruning.

CREATE TABLE IF NOT EXISTS public.publication_content_artifact (
  tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  media_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 10485760),
  content_encrypted bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workspace_id, content_hash)
);

CREATE TABLE IF NOT EXISTS public.publication_attestation (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  content_hash text NOT NULL,
  content_identity text NOT NULL,
  content_version text NOT NULL,
  supersedes_id uuid,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  policy_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL,
  signed_receipt jsonb,
  receipt_verified boolean NOT NULL DEFAULT false,
  attested_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publication_attestation_artifact_fk
    FOREIGN KEY (tenant_id, workspace_id, content_hash)
    REFERENCES public.publication_content_artifact (tenant_id, workspace_id, content_hash)
    ON DELETE RESTRICT,
  CONSTRAINT publication_attestation_supersedes_fk
    FOREIGN KEY (tenant_id, workspace_id, supersedes_id)
    REFERENCES public.publication_attestation (tenant_id, workspace_id, id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, workspace_id, idempotency_key),
  UNIQUE (tenant_id, workspace_id, id)
);

CREATE INDEX IF NOT EXISTS publication_attestation_content_idx
  ON public.publication_attestation (tenant_id, workspace_id, content_identity, content_version, created_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_publication_attestation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'publication attestations are immutable';
END;
$$;

DROP TRIGGER IF EXISTS publication_attestation_no_update ON public.publication_attestation;
CREATE TRIGGER publication_attestation_no_update
  BEFORE UPDATE ON public.publication_attestation
  FOR EACH ROW EXECUTE FUNCTION public.prevent_publication_attestation_mutation();

ALTER TABLE public.publication_content_artifact ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_attestation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.publication_content_artifact;
CREATE POLICY tenant_isolation ON public.publication_content_artifact TO spctre_app
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON public.publication_attestation;
CREATE POLICY tenant_isolation ON public.publication_attestation TO spctre_app
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

GRANT SELECT, INSERT ON public.publication_content_artifact TO spctre_app;
GRANT SELECT, INSERT ON public.publication_attestation TO spctre_app;

-- Authorized inspection and signer custody. `evidence:manage` is deliberately
-- separate from write access, so an ingestion client cannot enroll its own key.
ALTER TABLE public.service_token
  DROP CONSTRAINT IF EXISTS service_token_scopes_check;

ALTER TABLE public.service_token
  ADD CONSTRAINT service_token_scopes_check CHECK (
    scopes <@ ARRAY[
      'bundle:read'::text, 'decision:evaluate'::text, 'evidence:write'::text,
      'heartbeat:write'::text, 'policy:import'::text, 'blueprint:import'::text,
      'compliance:read'::text, 'simulation:run'::text, 'approvals:read'::text,
      'operations:read'::text, 'workflow:read'::text, 'members:read'::text,
      'workspaces:read'::text, 'e2e:write'::text, 'evidence:export'::text,
      'evidence:read'::text, 'evidence:manage'::text
    ]
    AND (NOT ('evidence:export' = ANY(scopes)) OR connector IS NOT NULL)
  );

CREATE TABLE IF NOT EXISTS public.publication_attestation_signing_challenge (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  entity_ref text NOT NULL CHECK (entity_ref ~ '^entity:[A-Za-z0-9._:-]+$'),
  key_id text NOT NULL,
  public_key text NOT NULL,
  challenge text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, workspace_id, key_id, public_key)
);

CREATE TABLE IF NOT EXISTS public.publication_attestation_signing_key (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  entity_ref text NOT NULL CHECK (entity_ref ~ '^entity:[A-Za-z0-9._:-]+$'),
  key_id text NOT NULL,
  public_key text NOT NULL,
  ownership_verified_at timestamptz NOT NULL,
  enrolled_by uuid NOT NULL REFERENCES public.app_principal(id) ON DELETE RESTRICT,
  replaces_key_id uuid REFERENCES public.publication_attestation_signing_key(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.app_principal(id) ON DELETE RESTRICT,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, workspace_id, key_id),
  UNIQUE (tenant_id, workspace_id, id),
  CONSTRAINT publication_attestation_signing_key_replacement_fk
    FOREIGN KEY (tenant_id, workspace_id, replaces_key_id)
    REFERENCES public.publication_attestation_signing_key(tenant_id, workspace_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT publication_attestation_signing_key_revocation_check
    CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
      OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS publication_attestation_signing_key_active_idx
  ON public.publication_attestation_signing_key (tenant_id, workspace_id, entity_ref, key_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.publication_attestation_signing_challenge ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_attestation_signing_key ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.publication_attestation_signing_challenge;
CREATE POLICY tenant_isolation ON public.publication_attestation_signing_challenge TO spctre_app
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON public.publication_attestation_signing_key;
CREATE POLICY tenant_isolation ON public.publication_attestation_signing_key TO spctre_app
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON public.publication_attestation_signing_challenge TO spctre_app;
GRANT SELECT, INSERT, UPDATE ON public.publication_attestation_signing_key TO spctre_app;
