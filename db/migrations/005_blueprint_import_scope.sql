-- Adds the `blueprint:import` service-token scope to the allowed set.
--
-- blueprint:import authorizes the automation/CI Blueprint import API
-- (POST /api/v1/blueprint/imports) and the `spctre blueprint import` CLI. It is
-- admin-issuable only and is never granted to runtime agent tokens, so a
-- governed agent cannot define, import, approve, or publish its own authority
-- Blueprint. It is distinct from the runtime read scope (`bundle:read`) and from
-- `policy:import`.
--
-- Idempotent: drops and re-adds the CHECK constraint with the extended set.

ALTER TABLE public.service_token
  DROP CONSTRAINT IF EXISTS service_token_scopes_check;

ALTER TABLE public.service_token
  ADD CONSTRAINT service_token_scopes_check CHECK (
    scopes <@ ARRAY[
      'bundle:read'::text,
      'decision:evaluate'::text,
      'evidence:write'::text,
      'heartbeat:write'::text,
      'policy:import'::text,
      'blueprint:import'::text,
      'compliance:read'::text,
      'simulation:run'::text,
      'approvals:read'::text,
      'operations:read'::text,
      'workflow:read'::text,
      'members:read'::text,
      'workspaces:read'::text,
      'e2e:write'::text
    ]
  );
