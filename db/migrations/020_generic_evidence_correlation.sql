-- Correlate provider-native agent identities through the existing cross-surface
-- registry. A provider binding uses surface_type evidence:<provider_type>.
ALTER TABLE public.canonical_evidence_event
  ADD COLUMN IF NOT EXISTS canonical_agent_id text;

CREATE INDEX IF NOT EXISTS canonical_evidence_event_canonical_agent_idx
  ON public.canonical_evidence_event (tenant_id, workspace_id, canonical_agent_id, occurred_at DESC)
  WHERE canonical_agent_id IS NOT NULL;
