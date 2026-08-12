-- Provider-neutral evidence ingestion keeps source material separate from the
-- interpreted evidence record. Mapping revisions are append-only so every
-- canonical event remains reproducible after an integration is reconfigured.

CREATE TABLE IF NOT EXISTS public.evidence_ingest_integration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspace(id) ON DELETE CASCADE,
  service_token_id uuid NOT NULL REFERENCES public.service_token(id) ON DELETE CASCADE,
  provider_type text NOT NULL CHECK (
    provider_type IN (
      'generic_json', 'generic_ndjson', 'cloudevents', 'otlp_logs',
      'bedrock_agentcore', 'docker_ai_governance', 'langsmith'
    )
  ),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, service_token_id)
);

CREATE TABLE IF NOT EXISTS public.evidence_ingest_mapping_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.evidence_ingest_integration(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  field_mapping jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  UNIQUE (integration_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS evidence_ingest_mapping_one_active_idx
  ON public.evidence_ingest_mapping_revision (integration_id)
  WHERE activated_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.evidence_source_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.evidence_ingest_integration(id) ON DELETE CASCADE,
  mapping_revision_id uuid REFERENCES public.evidence_ingest_mapping_revision(id),
  source_event_id text,
  idempotency_key text NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  rejected_reason text,
  UNIQUE (tenant_id, integration_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS evidence_source_record_lookup_idx
  ON public.evidence_source_record (tenant_id, integration_id, received_at DESC);

CREATE TABLE IF NOT EXISTS public.canonical_evidence_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspace(id) ON DELETE SET NULL,
  source_record_id uuid NOT NULL UNIQUE REFERENCES public.evidence_source_record(id) ON DELETE CASCADE,
  mapping_revision_id uuid REFERENCES public.evidence_ingest_mapping_revision(id),
  provider_type text NOT NULL,
  source_event_id text,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  principal_id text,
  agent_external_id text,
  canonical_agent_id text,
  action text NOT NULL,
  target_resource text,
  policy_reference text,
  environment text,
  enforcement_decision text NOT NULL CHECK (enforcement_decision IN ('allow', 'deny', 'escalate', 'observe')),
  correlation_confidence numeric(4,3),
  unresolved boolean NOT NULL DEFAULT false,
  source_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS canonical_evidence_event_tenant_time_idx
  ON public.canonical_evidence_event (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS canonical_evidence_event_workspace_time_idx
  ON public.canonical_evidence_event (tenant_id, workspace_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS canonical_evidence_event_canonical_agent_idx
  ON public.canonical_evidence_event (tenant_id, workspace_id, canonical_agent_id, occurred_at DESC)
  WHERE canonical_agent_id IS NOT NULL;

ALTER TABLE public.evidence_ingest_integration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_ingest_mapping_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_source_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_evidence_event ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.evidence_ingest_integration TO spctre_app
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON public.evidence_ingest_mapping_revision TO spctre_app
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON public.evidence_source_record TO spctre_app
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON public.canonical_evidence_event TO spctre_app
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.evidence_ingest_integration TO spctre_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evidence_ingest_mapping_revision TO spctre_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evidence_source_record TO spctre_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.canonical_evidence_event TO spctre_app;
