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

A host that records decisions must retain at least the policy artifact hash and
the evaluator version on the decision record. Those two fields are what make a
recorded decision reproducible after the kernel is upgraded. The trace need not
be stored per decision: it is regenerable by replaying the recorded artifact
through the recorded evaluator version.

A host must also verify the contract version it was handed. Accepting a result
from an unrecognized major version would apply presumed-compatible semantics to
published policy, which is a silent reinterpretation rather than an upgrade.

Compatibility is major-versioned. A consumer may accept a contract version
only when it recognizes that major version; it must reject an unknown major
version rather than applying presumed-compatible semantics. Adding optional
fields without changing the interpretation of existing fields is a minor
version change. Any semantic change requires a new major version and expanded
conformance fixtures.

This document intentionally specifies no FFI data layout. The N-API, C ABI,
and WASM adapters are transport details over this contract, not separate
policy languages.

The C ABI accepts bounded UTF-8 JSON bytes through `spctre_policy_evaluate`.
It currently limits requests and responses to 1 MiB, returns explicit status
codes, and uses `spctre_policy_buffer_free` for every successful response.
Callers must fail closed for every nonzero status code. A panic inside the
kernel is contained and reported as `SPCTRE_POLICY_INTERNAL_ERROR` rather than
unwinding into the host, which would abort the host process. The static library is
linked into its host process; it is not a policy-evaluator network service.
The supported C declarations are checked in at `native/include/spctre_policy_core.h`.

The portable build uses `wasm32-unknown-unknown` with the `wasm` feature and
`--no-default-features`. N-API bindings are excluded from that artifact; it
contains only the pure policy kernel and C-compatible JSON entry points. It is
shipped with the package as `native/spctre_policy_core.wasm` and instantiates
with no imports, so a portable host needs no generated glue and no build
toolchain. Because a WASM module can only address its own linear memory, such a
host reserves a request buffer with `spctre_policy_buffer_alloc`, writes the
request into it, and releases it with `spctre_policy_buffer_free` — the same
ownership rule that already applies to responses. In-process C hosts keep
passing their own pointers and do not use the allocator.
