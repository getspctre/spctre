-- Cross-process mutual exclusion for the periodic worker sweeps.
--
-- The sweeps assume a single runner — FOR UPDATE and SKIP LOCKED appear in none
-- of them. That held on the HTTP path, where runJobEndpoint took a per-job
-- advisory lock, and not on the in-process ticker, which took none. Every
-- replica running the ticker therefore ran every sweep independently:
-- duplicate SIEM delivery, duplicate notifications, duplicate SLA reminders.
--
-- A lease rather than an advisory lock, for two reasons. A session-level
-- advisory lock lives on its connection, so locking all eight jobs would pin
-- eight connections for the length of their sweeps against a pool that defaults
-- to ten. And an expired lease is positive evidence that its holder stopped,
-- which is the liveness signal job_run lacks: without it an interrupted sweep
-- stays open forever because nothing can tell a dead run from a slow one.
--
-- Cross-tenant infrastructure: no tenant_id, no RLS, as with job_run.
CREATE TABLE IF NOT EXISTS public.job_lease (
  job_name text PRIMARY KEY,
  -- The fencing identity: unique per *acquisition*, not per process. Renewal,
  -- release and run-id recording all match on it.
  --
  -- A process identity would not do. If a lease expires while its run is still
  -- alive and the same process reacquires it through another trigger, both runs
  -- carry the same process id — so the stale run's renewal succeeds, it never
  -- learns it was displaced, and its release deletes the successor's lease,
  -- admitting a third run. The token makes a displaced holder unable to touch
  -- the lease at all.
  token text NOT NULL,
  -- Which process holds it. Diagnostic only: never used as a guard, precisely
  -- because it cannot distinguish two acquisitions by the same process.
  holder text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  renewed_at timestamptz NOT NULL DEFAULT now(),
  -- Every timestamp here is written by the database's now(), never by the
  -- application: leases compare times recorded on different hosts, so app
  -- clocks would make correctness depend on NTP.
  expires_at timestamptz NOT NULL,
  -- The job_run this lease covers. An expired lease therefore identifies the
  -- ledger row its dead holder left open, which is how that row gets closed as
  -- ABANDONED. Not a foreign key: pruning old job_run history must not be
  -- blocked by, or cascade into, a live lease.
  run_id uuid
);
