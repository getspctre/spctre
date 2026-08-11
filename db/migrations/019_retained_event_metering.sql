-- Per-tenant, per-period measurement of retained governed events.
--
-- The usage surface has long rendered an "included" capacity and an over-limit
-- warning for retained events, but nothing measured them: the displayed count
-- was a live COUNT(*) over the evidence table. That cannot be a billing
-- authority — it is unbounded work on the read path, it has no billing-period
-- identity, and it silently changes when retention prunes rows.
--
-- This table is the authority instead. Two distinct counters, because they
-- answer different questions:
--
--   retained_count  the billable measure. Retained governed events are a
--                   standing capacity — how many the tenant currently holds,
--                   like storage — not a throughput allowance. It falls when
--                   evidence is pruned or erased, so it cannot be maintained by
--                   an increment; the reconciliation job recomputes it from
--                   durable evidence and stamps measured_at.
--
--   ingested_count  monotonic throughput telemetry: how many governed events
--                   arrived during the period. Incremented transactionally on
--                   the ingest path and never decremented. It is not the
--                   billing authority — billing a tenant for evidence that has
--                   since aged out of their window would overcharge them — but
--                   it is what makes drift detectable, since a retained count
--                   that never approaches a rising ingest count means retention
--                   is doing the work the invoice should reflect.
--
-- Conflating the two would either bill for evidence that no longer exists, or
-- lose all record of throughput the moment it is pruned.

-- The included retained-event capacity, materialized onto the profile for the
-- same reason as retention_window_days in migration 018: the reconciliation
-- job runs in the Go worker, and deriving capacity there would mean a second
-- copy of the plan ladder in a second language. Provisioning writes this from
-- apps/web/lib/entitlements/catalog.ts, and the worker reads the column.
ALTER TABLE public.tenant_commercial_profile
  ADD COLUMN IF NOT EXISTS retained_event_capacity bigint;

-- One-time backfill from the plan defaults, matching the catalog. A CASE is
-- acceptable here precisely because it runs once: it is the runtime derivation
-- that must not be duplicated.
UPDATE public.tenant_commercial_profile
SET retained_event_capacity = CASE plan_code
      WHEN 'HOSTED_TRIAL' THEN 1000
      WHEN 'TEAM' THEN 100000
      WHEN 'BUSINESS' THEN 1000000
      WHEN 'ENTERPRISE' THEN 10000000
      ELSE 1000
    END
WHERE retained_event_capacity IS NULL;

ALTER TABLE public.tenant_commercial_profile
  DROP CONSTRAINT IF EXISTS tenant_commercial_profile_retained_event_capacity_check;
ALTER TABLE public.tenant_commercial_profile
  ADD CONSTRAINT tenant_commercial_profile_retained_event_capacity_check
  CHECK (retained_event_capacity > 0);

-- With every profile now carrying both entitlement values — migration 018
-- backfilled the window, the statement above backfilled the capacity, and all
-- four provisioning paths write both — the database can hold the invariant
-- rather than the application re-asserting it.
--
-- This is what makes an unprovisioned profile impossible instead of merely
-- unlikely. A future write path that forgets these columns fails immediately
-- and visibly, rather than producing a tenant whose evidence is never pruned
-- and whose usage is never measured.
--
-- Re-run the window backfill rather than trusting migration 018's. A profile
-- created between the two migrations by a path that did not set the column
-- would otherwise fail the constraint below and abort the migration. This is
-- cheap and makes 019 self-sufficient instead of dependent on what happened
-- between deploys.
UPDATE public.tenant_commercial_profile
SET retention_window_days = CASE plan_code
      WHEN 'HOSTED_TRIAL' THEN 90
      WHEN 'TEAM' THEN 365
      WHEN 'BUSINESS' THEN 1095
      WHEN 'ENTERPRISE' THEN 2555
      ELSE 90
    END
WHERE retention_window_days IS NULL;

-- SET NOT NULL takes a brief ACCESS EXCLUSIVE lock and scans the table to
-- verify. tenant_commercial_profile has one row per tenant, so the scan is
-- trivial; at a size where it is not, the safe form is a NOT VALID check
-- constraint, VALIDATE CONSTRAINT, then SET NOT NULL.
ALTER TABLE public.tenant_commercial_profile
  ALTER COLUMN retention_window_days SET NOT NULL,
  ALTER COLUMN retained_event_capacity SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.tenant_usage_period (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    -- Billing-period identity. Half-open [period_start, period_end).
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    metric text NOT NULL,
    ingested_count bigint DEFAULT 0 NOT NULL,
    retained_count bigint,
    -- Snapshotted from the catalog so a historical overage stays explainable
    -- after the catalog changes.
    included_capacity bigint,
    entitlement_version text,
    overage_state text DEFAULT 'WITHIN_CAPACITY' NOT NULL,
    -- Set the first time the period crosses its included capacity. Doubles as
    -- the idempotency guard for the cap-transition event, so a tenant is
    -- notified once per period rather than once per event over the line.
    cap_notified_at timestamp with time zone,
    -- When retained_count was last recomputed from durable evidence.
    measured_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_usage_period_pkey PRIMARY KEY (id),
    CONSTRAINT tenant_usage_period_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE,
    CONSTRAINT tenant_usage_period_metric_check
      CHECK (metric = ANY (ARRAY['RETAINED_EVENTS'::text, 'SIMULATION_EVENTS'::text])),
    CONSTRAINT tenant_usage_period_overage_state_check
      CHECK (overage_state = ANY (ARRAY['WITHIN_CAPACITY'::text, 'OVER_CAPACITY'::text])),
    CONSTRAINT tenant_usage_period_range_check CHECK (period_end > period_start),
    CONSTRAINT tenant_usage_period_counts_check
      CHECK (ingested_count >= 0 AND (retained_count IS NULL OR retained_count >= 0))
);

-- The conflict target for the ingest-path upsert. One row per tenant, period
-- and metric; this is what makes a concurrent increment land on a single row.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_usage_period_identity_idx
  ON public.tenant_usage_period (tenant_id, metric, period_start);

-- Serves both the "current period for this tenant" read on the usage surface
-- and the reconciliation job's scan for periods needing measurement.
CREATE INDEX IF NOT EXISTS tenant_usage_period_tenant_period_idx
  ON public.tenant_usage_period (tenant_id, period_start DESC);

ALTER TABLE public.tenant_usage_period ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.tenant_usage_period TO spctre_app
  USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid))
  WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));

GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.tenant_usage_period TO spctre_app;

-- Reconciliation repairs the retained count from durable evidence. A material
-- correction is recorded so a disputed invoice can be traced to the moment the
-- measurement moved and by how much.
ALTER TABLE public.agt_operations_log
  DROP CONSTRAINT IF EXISTS agt_operations_log_event_type_check;

ALTER TABLE public.agt_operations_log
  ADD CONSTRAINT agt_operations_log_event_type_check CHECK (
    event_type = ANY (ARRAY[
      'POLICY_IMPORT', 'POLICY_PUBLISH', 'POLICY_APPROVE',
      'BLUEPRINT_APPROVE', 'BLUEPRINT_PUBLISH', 'BLUEPRINT_ROLLBACK',
      'EVIDENCE_INGEST', 'EVIDENCE_EXPORT', 'BUNDLE_EXPORT',
      'EVIDENCE_PRUNE', 'EVIDENCE_ERASURE', 'SIMULATION_RUN',
      'TRUST_SCORE_CHANGE', 'TRUST_POLICY_BREACH', 'CONTEXT_BUDGET_BREACH',
      'ECONOMIC_BUDGET_BREACH', 'ECONOMIC_USAGE_INGEST', 'IDENTITY_CHANGE',
      'TOKEN_ISSUED', 'TOKEN_REVOKED', 'TOKEN_REFRESHED',
      'ESCALATION_OPENED', 'ESCALATION_CLAIMED', 'ESCALATION_RESOLVED',
      'AGENT_TRIAGE', 'AGENT_RECOMMENDATION', 'SIMULATION_GUIDANCE',
      'GRC_DESTINATION_CONFIGURED', 'NOTIFICATION_SENT', 'NOTIFICATION_FAILED',
      'VERIFICATION_RUN', 'ACTION_RECEIPT_ISSUED', 'COMPLIANCE_EXPORT',
      'GATEWAY_DECISION_REPLAY_DIVERGED', 'USAGE_RECONCILED'
    ]::text[])
  );
