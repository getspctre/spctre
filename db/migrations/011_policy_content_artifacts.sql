-- Byte-exact policy artifact custody for AGT evidence reconstruction.
-- Semantic policy hashes remain on revisions; this store is keyed by the exact
-- loaded bytes and is deduplicated globally by SHA-256 content digest.

CREATE TABLE IF NOT EXISTS public.policy_content_artifact (
    content_hash text PRIMARY KEY,
    media_type text NOT NULL,
    size_bytes integer NOT NULL,
    content_encrypted bytea NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT policy_content_artifact_hash_check
      CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
    CONSTRAINT policy_content_artifact_size_check
      CHECK (size_bytes >= 0 AND size_bytes <= 10485760),
    CONSTRAINT policy_content_artifact_media_type_check
      CHECK (media_type IN ('application/yaml', 'text/yaml', 'application/json'))
);

CREATE TABLE IF NOT EXISTS public.runtime_evidence_policy_content_ref (
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    decision_id text NOT NULL,
    revision_id uuid,
    content_hash text NOT NULL REFERENCES public.policy_content_artifact(content_hash) ON DELETE RESTRICT,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, workspace_id, decision_id, content_hash)
);

CREATE INDEX IF NOT EXISTS runtime_evidence_policy_content_ref_hash_idx
  ON public.runtime_evidence_policy_content_ref (tenant_id, workspace_id, content_hash);

CREATE TABLE IF NOT EXISTS public.policy_content_artifact_access_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    content_hash text NOT NULL,
    token_id uuid,
    action text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT policy_content_artifact_access_action_check CHECK (action IN ('READ', 'WRITE', 'DENIED'))
);

-- Tenant isolation matches the baseline convention for every tenant-scoped
-- table. `policy_content_artifact` is deliberately excluded: it is keyed only by
-- content digest and deduplicated across tenants, so it carries no tenant_id.
-- Reads of it are gated by the tenant-scoped reference join in
-- readPolicyContentArtifactForEvidenceToken, never by the artifact row itself.
ALTER TABLE public.runtime_evidence_policy_content_ref ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_content_artifact_access_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.runtime_evidence_policy_content_ref;
CREATE POLICY tenant_isolation ON public.runtime_evidence_policy_content_ref TO spctre_app
  USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid))
  WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));

DROP POLICY IF EXISTS tenant_isolation ON public.policy_content_artifact_access_audit;
CREATE POLICY tenant_isolation ON public.policy_content_artifact_access_audit TO spctre_app
  USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid))
  WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));
