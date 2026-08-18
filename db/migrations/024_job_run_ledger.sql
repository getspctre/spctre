-- Durable record of periodic worker sweeps.
--
-- Sweep outcomes previously existed only as log lines, so nothing could answer
-- "did retention actually run this week?". Silence was indistinguishable from
-- success, which matters most for retention: evidence outlives its declared
-- window while the product reports a retention policy in force, and nothing
-- surfaces it.
--
-- Deliberately not RLS-gated and carries no tenant_id. A sweep is cross-tenant
-- infrastructure, not tenant data — the same posture as cli_onboarding_request
-- and the SAML AuthnRequest cache. The worker connects as the owner role.
CREATE TABLE IF NOT EXISTS public.job_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  -- TICKER is the worker's in-process scheduler; HTTP is an external
  -- scheduler calling /internal/jobs/*. Recorded so a deployment can prove
  -- which one is driving its sweeps, and notice if both are.
  trigger text NOT NULL CHECK (trigger IN ('TICKER', 'HTTP')),
  started_at timestamptz NOT NULL DEFAULT now(),
  -- NULL while a sweep is in flight, and left NULL if the process dies. It is
  -- not closed by the next run of the same job: only the HTTP job endpoints
  -- take the per-job advisory lock, so two runs can overlap and closing on
  -- start would mark a live run as finished. An interrupted run therefore
  -- stays open and reads as "started, never finished", which is the truth.
  -- ABANDONED is reserved for a liveness-based sweep (heartbeat) that can tell
  -- a dead run from a slow one.
  finished_at timestamptz,
  outcome text CHECK (outcome IN ('SUCCESS', 'FAILED', 'ABANDONED')),
  error text,
  duration_ms integer CHECK (duration_ms >= 0),
  -- An outcome and a finish time are recorded together or not at all.
  CONSTRAINT job_run_finished_consistent CHECK (
    (finished_at IS NULL AND outcome IS NULL)
    OR (finished_at IS NOT NULL AND outcome IS NOT NULL)
  )
);

-- Serves both read paths: the latest run for one job, and the open-run lookup
-- the next start uses to close orphans.
CREATE INDEX IF NOT EXISTS job_run_name_started_idx
  ON public.job_run (job_name, started_at DESC);

-- Supports pruning by age in the retention sweep.
CREATE INDEX IF NOT EXISTS job_run_started_idx
  ON public.job_run (started_at);
