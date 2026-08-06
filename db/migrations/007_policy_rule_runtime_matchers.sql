-- Persist the rule fields the runtime evaluator matches on.
--
-- policy_rule could express a rule's identity, effect, and connector/action/
-- domain scoping, but not its semanticChecks or parameterConstraints. Those
-- existed only inside policy_revision.source_document and were recovered by
-- re-parsing that document with the TypeScript AGT parser on every read.
--
-- That made the table a lossy representation of a rule: anything reading
-- policy_rule directly — notably the Go worker, which has no AGT parser —
-- would evaluate a rule as a bare connector/action match and silently ignore
-- its thresholds and semantic checks. Under-enforcement, with no error.
--
-- Storing them here makes policy_rule the complete, parser-free source both
-- engines read.
--
-- NULL means "not yet materialised" — a row written before this migration and
-- not yet processed by scripts/backfill-policy-rule-matchers.mjs, which can run
-- the parser that SQL cannot. A rule that genuinely declares no matchers stores
-- an empty array, not NULL. Keeping those two cases distinct is what lets a
-- reader decide whether it must fall back to parsing source_document, and lets
-- that fallback eventually be retired once nothing is NULL.

ALTER TABLE public.policy_rule
  ADD COLUMN IF NOT EXISTS semantic_checks jsonb,
  ADD COLUMN IF NOT EXISTS parameter_constraints jsonb;

COMMENT ON COLUMN public.policy_rule.semantic_checks IS
  'Serialized SemanticCheck[]; [] when the rule declares none, NULL when not yet backfilled.';
COMMENT ON COLUMN public.policy_rule.parameter_constraints IS
  'Serialized PolicyParameterConstraint[]; [] when none, NULL when not yet backfilled.';

-- Lets the backfill and the read-path guard find unmaterialised rows without
-- scanning the whole table. Partial, so it shrinks to nothing as the backfill
-- progresses and costs nothing once complete.
CREATE INDEX IF NOT EXISTS policy_rule_unmaterialized_idx
  ON public.policy_rule (revision_id)
  WHERE semantic_checks IS NULL AND parameter_constraints IS NULL;
