# Published policy evaluator contract

The published-policy evaluator is a deterministic, portable contract. Its
reference corpus is generated at `conformance/policy-rules.json` from the
TypeScript implementation in `src/schema.ts`.

Version `1.0` defines the request fields used by `evaluateDecision`, the
`ALLOW`, `WARN`, `ESCALATE`, and `DENY` result statuses, exact and trailing
`.*` action matching, domain matching, semantic and parameter constraints,
effect precedence, and policy-layer composition. The generated corpus is the
executable specification for those details.

All implementations must expose the evaluator version, request-schema
version, result-schema version, the policy artifact hash, and a bounded trace
with each decision. An implementation must fail closed when it cannot parse a
supported request or when a request exceeds its documented resource limits.

Compatibility is major-versioned. A consumer may accept a contract version
only when it recognizes that major version; it must reject an unknown major
version rather than applying presumed-compatible semantics. Adding optional
fields without changing the interpretation of existing fields is a minor
version change. Any semantic change requires a new major version and expanded
conformance fixtures.

This document intentionally specifies no FFI data layout. The N-API, C ABI,
and WASM adapters are transport details over this contract, not separate
policy languages.
