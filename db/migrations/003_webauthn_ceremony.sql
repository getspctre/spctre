-- Real WebAuthn ceremony support.
--
-- The original passkey login "finish" created a session after only matching a
-- challenge cookie and an enrolled credential ID — it never verified an
-- authenticator assertion. Moving to a verified ceremony (see
-- apps/web/app/api/auth/passkey/*) requires three schema changes:
--
--   1. Credential IDs must be globally unique, not unique per tenant. A verified
--      credential maps to exactly one principal/tenant, and usernameless
--      (discoverable) login looks a credential up globally before any tenant is
--      known. Replace the tenant-scoped UNIQUE (tenant_id, credential_id_b64)
--      with a global unique index on credential_id_b64.
--
--   2. A server-side, one-time challenge store. The challenge must be generated
--      and consumed server-side to prevent replay, and for usernameless login
--      there is no principal/tenant to bind at "start". webauthn_challenge is
--      RLS-excluded and written pre-session, the same pattern as
--      saml_authn_request and cli_onboarding_request.
--
--   3. Existing passkey rows stored a browser-supplied, never-verified public key
--      that the verification library cannot consume. Delete them so principals
--      re-enroll through the verified registration ceremony.
--
-- The runner (db/migrate.ts) applies each file exactly once, tracked in
-- schema_migrations, inside a transaction that rolls back on failure. The DDL
-- below is guarded (IF [NOT] EXISTS) so a rolled-back attempt retries cleanly.
--
-- The DELETE is NOT idempotent and is a deliberate one-time cleanup: it purges
-- the pre-ceremony rows exactly once as part of this migration. It must never be
-- replayed manually against a live database — doing so would wipe passkeys that
-- users have since re-enrolled through the verified ceremony.

-- 1. Existing credentials hold unverified public keys — remove them (one-time).
DELETE FROM public.passkey;

-- 2. Swap tenant-scoped uniqueness for global uniqueness on credential_id_b64.
ALTER TABLE public.passkey
  DROP CONSTRAINT IF EXISTS passkey_tenant_id_credential_id_b64_key;

CREATE UNIQUE INDEX IF NOT EXISTS passkey_credential_id_b64_key
  ON public.passkey (credential_id_b64);

-- 3. Server-side one-time WebAuthn challenge store (RLS-excluded, pre-session).
CREATE TABLE IF NOT EXISTS public.webauthn_challenge (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purpose text NOT NULL,
    challenge text NOT NULL,
    principal_id uuid,
    tenant_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT webauthn_challenge_pkey PRIMARY KEY (id),
    CONSTRAINT webauthn_challenge_purpose_check
      CHECK (purpose = ANY (ARRAY['REGISTRATION'::text, 'AUTHENTICATION'::text]))
);

CREATE INDEX IF NOT EXISTS webauthn_challenge_expires_at_idx
  ON public.webauthn_challenge (expires_at);

GRANT SELECT, INSERT, DELETE ON TABLE public.webauthn_challenge TO spctre_app;
