-- Materialize the effective commercial entitlements onto the tenant profile.
--
-- The retention window was previously derived at read time from plan_code by
-- every consumer that needed it, which is why they disagreed. Provisioning now
-- writes the effective window when a plan is established or changes, and the
-- retention worker reads the column instead of re-deriving from the plan name.
--
-- The catalog version and effective time are recorded alongside it so a
-- historical retention decision stays explainable after the catalog moves on:
-- "this tenant was pruned at 365 days because catalog 2026-08-11.1 was in
-- force from this instant" is answerable, where "TEAM means 365 days" is not,
-- once TEAM stops meaning that.

ALTER TABLE public.tenant_commercial_profile
  ADD COLUMN IF NOT EXISTS entitlement_version text,
  ADD COLUMN IF NOT EXISTS entitlement_effective_at timestamp with time zone;

-- Backfill every existing profile from the plan defaults in
-- apps/web/lib/entitlements/catalog.ts. Only rows with no explicit window are
-- touched: a negotiated value already on the row is the authority and must
-- survive this migration.
--
-- entitlement_effective_at is deliberately left NULL for backfilled rows
-- rather than set to now(). These windows were in force before this migration
-- ran, and stamping them with the migration time would assert an effective
-- date that is not true.
UPDATE public.tenant_commercial_profile
SET retention_window_days = CASE plan_code
      WHEN 'HOSTED_TRIAL' THEN 90
      WHEN 'TEAM' THEN 365
      WHEN 'BUSINESS' THEN 1095
      WHEN 'ENTERPRISE' THEN 2555
      ELSE 90
    END
WHERE retention_window_days IS NULL;

-- A window of zero or below would mean "retain nothing" and delete a tenant's
-- evidence on the next sweep. Nothing should ever write one; reject it at the
-- boundary rather than discover it from an empty evidence table.
ALTER TABLE public.tenant_commercial_profile
  DROP CONSTRAINT IF EXISTS tenant_commercial_profile_retention_window_days_check;
ALTER TABLE public.tenant_commercial_profile
  ADD CONSTRAINT tenant_commercial_profile_retention_window_days_check
  CHECK (retention_window_days IS NULL OR retention_window_days > 0);
