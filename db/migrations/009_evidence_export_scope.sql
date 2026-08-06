-- Adds a connector-bound, read-only evidence export scope.
-- A workspace can host several connectors, so `evidence:export` is valid only
-- for a token whose connector is persisted server-side.

ALTER TABLE public.service_token
  ADD COLUMN IF NOT EXISTS connector text;

ALTER TABLE public.service_token
  DROP CONSTRAINT IF EXISTS service_token_scopes_check;

ALTER TABLE public.service_token
  ADD CONSTRAINT service_token_scopes_check CHECK (
    scopes <@ ARRAY[
      'bundle:read'::text, 'decision:evaluate'::text, 'evidence:write'::text,
      'heartbeat:write'::text, 'policy:import'::text, 'blueprint:import'::text,
      'compliance:read'::text, 'simulation:run'::text, 'approvals:read'::text,
      'operations:read'::text, 'workflow:read'::text, 'members:read'::text,
      'workspaces:read'::text, 'e2e:write'::text, 'evidence:export'::text
    ]
    AND (NOT ('evidence:export' = ANY(scopes)) OR connector IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS service_token_evidence_export_connector_idx
  ON public.service_token (tenant_id, workspace_id, connector)
  WHERE revoked_at IS NULL AND 'evidence:export' = ANY(scopes);
