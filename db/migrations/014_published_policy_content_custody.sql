-- Exact-byte custody for immutable policy publication events. A semantic
-- revision may be composed into multiple publications, so bind bytes to the
-- publish event rather than assuming one byte representation per revision.

CREATE TABLE IF NOT EXISTS public.policy_publish_content_artifact (
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    publish_id uuid NOT NULL REFERENCES public.policy_publish(id) ON DELETE CASCADE,
    revision_id uuid NOT NULL REFERENCES public.policy_revision(id) ON DELETE RESTRICT,
    content_hash text NOT NULL REFERENCES public.policy_content_artifact(content_hash) ON DELETE RESTRICT,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (publish_id, content_hash)
);

CREATE INDEX IF NOT EXISTS policy_publish_content_artifact_revision_idx
  ON public.policy_publish_content_artifact (tenant_id, workspace_id, revision_id, created_at DESC);

ALTER TABLE public.policy_publish_content_artifact ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.policy_publish_content_artifact;
CREATE POLICY tenant_isolation ON public.policy_publish_content_artifact TO spctre_app
  USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid))
  WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));
