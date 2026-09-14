-- Machine-driven policy review and publish.
--
-- `approvals:write` and `publish:write` let a service token submit an approval
-- or publish a revision through the same authorization the review UI uses: the
-- token's own principal is the actor, so a key can only approve in the roles its
-- owner holds, and a two-role workflow still needs two keys owned by two
-- reviewers. Neither scope is issued to runtime agent tokens.
--
-- `e2e:write` is removed. It backed a support API that drafted, approved and
-- published outside the reviewed path, and those routes are gone: drafting is
-- `policy:import`, approving and publishing are the scopes added here. Tokens
-- holding it are stripped of the scope, and revoked if nothing else remains --
-- a token whose only capability was removed should not keep authenticating.

UPDATE public.service_token
SET revoked_at = now()
WHERE revoked_at IS NULL
  AND scopes = ARRAY['e2e:write'::text];

UPDATE public.service_token
SET scopes = array_remove(scopes, 'e2e:write')
WHERE 'e2e:write' = ANY(scopes);

ALTER TABLE public.service_token
  DROP CONSTRAINT IF EXISTS service_token_scopes_check;

ALTER TABLE public.service_token
  ADD CONSTRAINT service_token_scopes_check CHECK (
    scopes <@ ARRAY[
      'bundle:read'::text, 'decision:evaluate'::text, 'evidence:write'::text,
      'heartbeat:write'::text, 'policy:import'::text, 'blueprint:import'::text,
      'compliance:read'::text, 'simulation:run'::text, 'approvals:read'::text,
      'approvals:write'::text, 'publish:write'::text,
      'operations:read'::text, 'workflow:read'::text, 'members:read'::text,
      'workspaces:read'::text, 'evidence:export'::text,
      'evidence:read'::text, 'evidence:manage'::text
    ]
    AND (NOT ('evidence:export' = ANY(scopes)) OR connector IS NOT NULL)
  );
