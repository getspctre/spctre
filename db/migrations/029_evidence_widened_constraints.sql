-- Drop the superseded status and runtime_stack checks on runtime_evidence_event.
--
-- The table carries two CHECK constraints per column, and both must pass, so the
-- narrower one decides:
--
--   status_check         ALLOW, DENY, WARN, ESCALATE
--   status_check1        ALLOW, DENY, WARN            <- wins
--
--   runtime_stack_check  12 stacks, incl. LANGGRAPH, OPENCODE, CLAUDE_CODE
--   runtime_stack_check1 9 stacks, those three absent  <- wins
--
-- So an ESCALATE decision could not be recorded as evidence at all, and neither
-- could anything from three of the twelve declared runtime stacks. Both surface
-- as a 500 from POST /api/evidence, after the request has validated.
--
-- The `check1` names are Postgres auto-naming a collision: the constraints were
-- widened with ADD CONSTRAINT and the originals were never dropped, so
-- 001_launch_schema.sql — a dump of that state — captured both. Reading the
-- schema, the widened constraint is one line above the one that overrides it,
-- which is why this survived: the intent is visible and the effect is inverted.
--
-- Only the superseded constraint is dropped. The widened one stays and keeps
-- enforcing the allowed sets, so this narrows nothing and needs no backfill —
-- no existing row can violate what remains.
--
-- Partitions need care. Those in 001 were created standalone and ATTACHed, so
-- they hold their own copies; those created since by
-- spctre_ensure_runtime_evidence_partitions used `PARTITION OF`, so theirs are
-- inherited. An inherited constraint cannot be dropped from the child, so the
-- parent is dropped first — which removes the inherited copies — and the
-- remaining local ones are swept afterwards.
--
-- Every identifier is schema-qualified: 001_launch_schema.sql sets search_path
-- to '' for the session and the runner applies every file on that connection.

DO $$
DECLARE
  stale_constraint text;
  partition_table regclass;
BEGIN
  FOREACH stale_constraint IN ARRAY ARRAY[
    'runtime_evidence_event_status_check1',
    'runtime_evidence_event_runtime_stack_check1'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.runtime_evidence_event'::regclass
        AND conname = stale_constraint
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.runtime_evidence_event DROP CONSTRAINT %I',
        stale_constraint
      );
    END IF;

    FOR partition_table IN
      SELECT inhrelid::regclass
      FROM pg_catalog.pg_inherits
      WHERE inhparent = 'public.runtime_evidence_event'::regclass
    LOOP
      EXECUTE format(
        'ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I',
        partition_table,
        stale_constraint
      );
    END LOOP;
  END LOOP;
END $$;
