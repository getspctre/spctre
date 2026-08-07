-- Binds evidence-export tokens to an explicit revision set and time window.
-- The token's tenant/workspace/connector identity is still authoritative; a
-- grant is an additional narrowing constraint, never an alternate selector.

CREATE TABLE IF NOT EXISTS public.service_token_evidence_export_grant (
    token_id uuid NOT NULL REFERENCES public.service_token(id) ON DELETE CASCADE,
    revision_id uuid NOT NULL REFERENCES public.policy_revision(id) ON DELETE RESTRICT,
    not_before timestamp with time zone NOT NULL DEFAULT '-infinity'::timestamp with time zone,
    not_after timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (token_id, revision_id),
    CONSTRAINT service_token_evidence_export_grant_window_check
      CHECK (not_after IS NULL OR not_after > not_before)
);

CREATE INDEX IF NOT EXISTS service_token_evidence_export_grant_token_window_idx
  ON public.service_token_evidence_export_grant (token_id, not_before, not_after);
