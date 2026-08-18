-- Bound SIEM forwarding retries.
--
-- The forwarder advances a stream's cursor only after a successful batch send,
-- which makes delivery at-least-once but also means a permanently broken
-- endpoint replays the same batch on every sweep forever, with nothing but a
-- warning line to show for it. The circuit breaker limits how fast that
-- happens, not how long it goes on.
--
-- Notification delivery already solved this shape with an attempt ceiling and
-- dead-lettering (WORKER_NOTIFICATION_MAX_ATTEMPTS); SIEM never got the same
-- treatment. These columns are the per-stream equivalent.
--
-- On exhaustion the forwarder disables the stream rather than skipping the
-- batch. SIEM export is a delivery path for compliance evidence, so dropping
-- events to keep the queue moving would trade a loud, fixable failure for a
-- silent, permanent gap. Disabling reuses the operator affordance that already
-- exists — re-enabling a stream in the UI clears this state and resumes from
-- the unchanged cursor, losing nothing.
ALTER TABLE public.workspace_siem_stream
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0
    CHECK (consecutive_failures >= 0),
  -- Why it stopped, kept so an operator does not have to correlate logs to
  -- find out.
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS last_failure_at timestamptz,
  -- Set only when the forwarder itself disabled the stream. Distinguishes that
  -- from an operator who turned it off deliberately, which the `enabled` flag
  -- alone cannot express.
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
