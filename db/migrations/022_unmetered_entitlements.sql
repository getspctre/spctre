-- Allow a tenant to hold no entitlement limits at all.
--
-- Migration 019 made retention_window_days and retained_event_capacity NOT
-- NULL, on the reasoning that every provisioning path materialized both from
-- the entitlement catalog. That held only while the catalog was a constant
-- compiled into the application — that is, while every deployment, including
-- one that had never bought a plan, provisioned tenants from the hosted trial's
-- numbers. It did so by way of the plan-code default, and the consequence was
-- that a self-hosted install refused ingest at the trial's capacity and pruned
-- evidence on the trial's 90-day window.
--
-- The catalog is now supplied by the deployment (see the entitlement-catalog
-- slot), and a deployment with none runs unmetered: no capacity and no window.
-- NULL is how the database says that, and both readers already treat it as the
-- absence of a limit rather than as zero:
--
--   * the retention worker's prune compares against
--     make_interval(days => retention_window_days), which is NULL for a NULL
--     window, so the comparison is never true and nothing is deleted;
--   * the usage reconciliation job COALESCEs the capacity and reports an
--     overage only against a capacity that exists.
--
-- Values are left exactly as they are: a tenant provisioned under a commercial
-- catalog keeps the window it was sold, and this migration does not decide for
-- any deployment whether its existing tenants should become unmetered.

ALTER TABLE public.tenant_commercial_profile
  ALTER COLUMN retention_window_days DROP NOT NULL,
  ALTER COLUMN retained_event_capacity DROP NOT NULL;

-- The window's check already admitted NULL; the capacity's did not, so a NULL
-- capacity would have been rejected by the constraint rather than the column.
ALTER TABLE public.tenant_commercial_profile
  DROP CONSTRAINT IF EXISTS tenant_commercial_profile_retained_event_capacity_check;
ALTER TABLE public.tenant_commercial_profile
  ADD CONSTRAINT tenant_commercial_profile_retained_event_capacity_check
  CHECK (retained_event_capacity IS NULL OR retained_event_capacity > 0);
