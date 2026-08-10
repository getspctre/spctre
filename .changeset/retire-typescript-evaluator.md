---
"@spctre/policy-schema": minor
"@spctre/cli": minor
---

Retire the TypeScript policy evaluator. `evaluateDecision` is now a transport
onto the Rust kernel rather than a second implementation of matching, semantic
checks, parameter constraints and effect precedence. The CLI's local hook and
`spctre test` evaluate through the portable kernel, so a locally blocked action
and a runtime-blocked action are the same judgement, and neither needs a
per-platform native binary.

Removes the now-duplicate exports `classifySemanticIntent`,
`evaluateSemanticChecks` and `evaluateParameterConstraints`. Callers that
evaluated policy through them should call `evaluateDecision` (or the portable
kernel) instead, which returns the same verdicts plus the decision trace and
evaluator provenance.
