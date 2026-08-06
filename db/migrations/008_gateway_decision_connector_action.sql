-- Preserve the governed connector/action on the decision itself. Runtime
-- evidence is supplementary audit data and is not guaranteed to exist when a
-- reviewer or runtime client reads an escalation.
--
-- DDL only. Historical rows are recovered by
-- scripts/backfill-gateway-decision-connector-action.mjs: the migration runner
-- wraps each file in a single transaction, so a backfill here would hold the
-- ADD COLUMN's ACCESS EXCLUSIVE lock on gateway_decision for the duration of a
-- full scan of runtime_evidence_event, blocking every gateway decide write.
-- The ADD COLUMN itself is nullable with no default, so it takes no rewrite.
ALTER TABLE public.gateway_decision
  ADD COLUMN IF NOT EXISTS connector text,
  ADD COLUMN IF NOT EXISTS action text;

COMMENT ON COLUMN public.gateway_decision.connector IS
  'Connector supplied at gateway decision time; retained independently of runtime evidence.';
COMMENT ON COLUMN public.gateway_decision.action IS
  'Action supplied at gateway decision time; retained independently of runtime evidence.';
