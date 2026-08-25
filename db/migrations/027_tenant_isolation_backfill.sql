-- Row-level security for tenant-bearing tables that were granted to spctre_app
-- without it.
--
-- These tables carry a tenant_id and are reachable by the application role, but
-- isolation rested entirely on the WHERE clauses in the repositories. Every
-- write path below already runs on a tenant-bound connection (`sql`/`tx` in the
-- web app, beginTenantTx in the worker) or on the owner connection for
-- deliberately cross-tenant sweeps, which bypasses RLS — so the policies
-- constrain the app role without changing what any current caller can do.
--
-- Two pre-session tables are deliberately left out and must stay out:
-- webauthn_challenge and saml_authn_request. Both are written before any
-- session exists, on the owner connection, with no tenant context to enforce
-- against; webauthn_challenge.tenant_id is nullable precisely because
-- usernameless login has no tenant at the "start" step, so a tenant_isolation
-- policy would reject the rows the login flow depends on. Their protection is
-- one-time consumption and a short TTL, not RLS.
-- scripts/check-rls-coverage.mjs holds that exclusion list and fails CI when a
-- new tenant-bearing table appears without a policy or an entry.

ALTER TABLE public.admin_audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bundle_export_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scim_group_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_sla_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_onboarding_milestone ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agt_operations_log_chain_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.runtime_evidence_chain_head ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.admin_audit_event;
CREATE POLICY tenant_isolation ON public.admin_audit_event TO spctre_app
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- bundle_export_log.tenant_id is text, not uuid. Casting the setting to uuid
-- here would fail at plan time with "operator does not exist: text = uuid".
DROP POLICY IF EXISTS tenant_isolation ON public.bundle_export_log;
CREATE POLICY tenant_isolation ON public.bundle_export_log TO spctre_app
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON public.notification_delivery;
CREATE POLICY tenant_isolation ON public.notification_delivery TO spctre_app
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON public.scim_group_mapping;
CREATE POLICY tenant_isolation ON public.scim_group_mapping TO spctre_app
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON public.tenant_sla_calendar;
CREATE POLICY tenant_isolation ON public.tenant_sla_calendar TO spctre_app
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON public.web_onboarding_milestone;
CREATE POLICY tenant_isolation ON public.web_onboarding_milestone TO spctre_app
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- The chain heads anchor the tamper-evident hash chains. A cross-tenant write
-- here does not leak a row, it forks another tenant's chain, so these matter
-- more than their one-column-per-tenant shape suggests.
DROP POLICY IF EXISTS tenant_isolation ON public.agt_operations_log_chain_head;
CREATE POLICY tenant_isolation ON public.agt_operations_log_chain_head TO spctre_app
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON public.runtime_evidence_chain_head;
CREATE POLICY tenant_isolation ON public.runtime_evidence_chain_head TO spctre_app
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
