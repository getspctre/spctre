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
-- engines read. Nullable because "no constraints" is the common case and
-- because existing rows are backfilled separately by
-- scripts/backfill-policy-rule-matchers.mjs, which can run the parser.

ALTER TABLE public.policy_rule
  ADD COLUMN IF NOT EXISTS semantic_checks jsonb,
  ADD COLUMN IF NOT EXISTS parameter_constraints jsonb;

COMMENT ON COLUMN public.policy_rule.semantic_checks IS
  'Serialized SemanticCheck[]; NULL when the rule declares none.';
COMMENT ON COLUMN public.policy_rule.parameter_constraints IS
  'Serialized PolicyParameterConstraint[]; NULL when the rule declares none.';

-- Lets the backfill and any consistency audit find unmaterialized rows without
-- scanning the whole table. Partial, so it stays small and disappears in
-- practice once the backfill has run.
CREATE INDEX IF NOT EXISTS policy_rule_unmaterialized_idx
  ON public.policy_rule (revision_id)
  WHERE semantic_checks IS NULL AND parameter_constraints IS NULL;
