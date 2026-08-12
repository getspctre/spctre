-- Durable record of usage reported to the billing provider.
--
-- Submitting usage is the first step in this system that moves money, and it
-- happens over a network that fails in the usual ways: a request that times out
-- may or may not have been received, and a retry that assumes it was not is how
-- a tenant gets charged twice.
--
-- The idempotency key is therefore derived from what the submission *is* rather
-- than from when it was sent: tenant, billing period, metric, and the
-- entitlement version the measurement was taken against. Two attempts to report
-- the same period's usage produce the same key and collide here, whether the
-- retry comes from the job, an operator, or a redeployed worker.
--
-- The entitlement version participates deliberately. If a tenant's catalog
-- version changes mid-period, the resulting figure is measured against a
-- different capacity and is a different submission, not a duplicate of the
-- earlier one.

CREATE TABLE IF NOT EXISTS public.tenant_usage_submission (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    usage_period_id uuid NOT NULL,
    metric text NOT NULL,
    -- Composed by the application from (tenant, period, metric, entitlement
    -- version). Stored rather than recomputed so a historical submission stays
    -- explainable after the composition rule changes.
    idempotency_key text NOT NULL,
    -- The quantity reported, frozen at submission time. The measurement it came
    -- from keeps moving; an invoice dispute is about what was sent.
    reported_quantity bigint NOT NULL,
    included_capacity bigint,
    entitlement_version text,
    billing_provider text DEFAULT 'PADDLE' NOT NULL,
    -- Provider-side identifiers, populated once the provider has acknowledged.
    provider_submission_id text,
    provider_invoice_id text,
    status text DEFAULT 'PENDING' NOT NULL,
    -- Retained for operator diagnosis; a failed submission must be recoverable
    -- without guessing why it failed.
    last_error text,
    attempt_count integer DEFAULT 0 NOT NULL,
    submitted_at timestamp with time zone,
    settled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_usage_submission_pkey PRIMARY KEY (id),
    CONSTRAINT tenant_usage_submission_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE,
    CONSTRAINT tenant_usage_submission_usage_period_id_fkey
      FOREIGN KEY (usage_period_id) REFERENCES public.tenant_usage_period(id) ON DELETE CASCADE,
    CONSTRAINT tenant_usage_submission_metric_check
      CHECK (metric = ANY (ARRAY['RETAINED_EVENTS'::text, 'SIMULATION_EVENTS'::text])),
    CONSTRAINT tenant_usage_submission_billing_provider_check
      CHECK (billing_provider = ANY (ARRAY['PADDLE'::text])),
    -- A submission is PENDING until sent, SUBMITTED once the provider has
    -- acknowledged it, SETTLED once a webhook confirms the invoice, and FAILED
    -- when it could not be delivered. FAILED is retryable; SETTLED is terminal.
    CONSTRAINT tenant_usage_submission_status_check
      CHECK (status = ANY (ARRAY['PENDING'::text, 'SUBMITTED'::text, 'SETTLED'::text, 'FAILED'::text])),
    CONSTRAINT tenant_usage_submission_reported_quantity_check CHECK (reported_quantity >= 0),
    CONSTRAINT tenant_usage_submission_attempt_count_check CHECK (attempt_count >= 0)
);

-- The guarantee this table exists for: one submission per key, enforced by the
-- database rather than by the caller remembering to check first.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_usage_submission_idempotency_key_idx
  ON public.tenant_usage_submission (idempotency_key);

-- Reconciliation scans for submissions awaiting acknowledgement or retry.
CREATE INDEX IF NOT EXISTS tenant_usage_submission_status_idx
  ON public.tenant_usage_submission (status, updated_at)
  WHERE status <> 'SETTLED';

CREATE INDEX IF NOT EXISTS tenant_usage_submission_tenant_idx
  ON public.tenant_usage_submission (tenant_id, created_at DESC);

ALTER TABLE public.tenant_usage_submission ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.tenant_usage_submission TO spctre_app
  USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid))
  WITH CHECK ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));

GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.tenant_usage_submission TO spctre_app;
