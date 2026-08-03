-- Drops the global UNIQUE (tenant_id, blueprint_id, definition_hash) constraint
-- on agent_blueprint_revision.
--
-- That constraint prevented a definition from ever recurring in a Blueprint's
-- revision history, which broke source-rollback convergence: after publishing A
-- then B, reverting the source to A could not append a new A revision, so it
-- could never be published and re-selected at runtime (runtime picks the
-- latest-PUBLISHED revision by published_at, and the old A was already
-- PUBLISHED and superseded). Idempotency is now HEAD-based instead: an import or
-- revision-create no-ops only when the definition is unchanged from the current
-- head (see createAgentBlueprintRevision and importBlueprintForToken).
--
-- Idempotent: only drops if present.

ALTER TABLE public.agent_blueprint_revision
  DROP CONSTRAINT IF EXISTS agent_blueprint_revision_tenant_id_blueprint_id_definition__key;
