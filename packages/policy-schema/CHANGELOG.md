# @spctre/policy-schema

## 0.6.0

### Minor Changes

- 00b605d: Add the `GATEWAY_DECISION_REPLAY_DIVERGED` operations-log event type. Gateway
  decisions are now first-write-wins audit records, so a replayed decision that
  disagrees with the persisted one is retained as its own event rather than
  rewriting the original.

## 0.5.0

### Minor Changes

- 7f4c51e: Harden and widen the policy kernel boundary.

  - A panic inside the kernel is contained and reported as
    `SPCTRE_POLICY_INTERNAL_ERROR` rather than unwinding into the host, where it
    would abort the host process. Callers already fail closed on any nonzero
    status.
  - Layer composition is exposed on the N-API and C ABI transports, and
    `composePolicyLayers` delegates to it. Composition returns the winning layer
    and rule positions rather than composed rules, so rule fields the kernel does
    not model survive composition unchanged.
  - New `validatePolicyRules` and `validatePolicyBundleLayers` report whether a
    bundle can be enforced at all: unsupported or mistyped constraint operators,
    unsupported action wildcards, missing or unknown effects, empty semantic
    prompts, duplicate rule IDs within a layer, unknown layer scopes, and layers
    ordered so that precedence would invert. Each of those otherwise produces a
    rule that silently never matches.
  - New `policyKernelLimits` and `measurePolicyRequestBudget` report the kernel's
    own request bounds and how much of them a composed policy consumes, so hosts
    can check a policy against the real limits instead of restating them.

- d0f2189: Ship the portable policy kernel. `@spctre/policy-schema/wasm` instantiates the
  same bounded-JSON kernel the native addon and the Go worker use, with no
  generated glue and no build toolchain, for hosts that cannot load a native
  binary. `EvaluationResult` now exposes the evaluator and schema versions and the
  policy artifact hash the kernel already returned, and the kernel's own resource
  limits are readable rather than restated by callers.
- ebb2278: Retire the TypeScript policy evaluator. `evaluateDecision` is now a transport
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

### Patch Changes

- 1038508: Embed the semantic topic table from inside the Rust kernel crate so the crate
  builds outside a full workspace checkout.

## 0.4.0

### Minor Changes

- 7745bb8: Publish the Rust policy evaluator as the authoritative runtime kernel, including portable WASM and C ABI build targets for delivery adapters.

### Patch Changes

- 9f9aca8: Add a hash-aware adapter for AGT runtime evidence v1 packets.
- 9f9aca8: Expose verifier-lock and byte-exact policy-content provenance on AGT verification results.
- 9f9aca8: Expose verification staleness reasons so consumers can invalidate results when
  the verifier lock digest or byte-exact policy content hash changes.

## 0.3.0

### Minor Changes

- 728c4cc: Extract the `classifySemanticIntent` vocabulary into shared, exported tables.

  - New exports: `SEMANTIC_TOPICS`, `SEMANTIC_STOP_WORDS`, `SEMANTIC_GENERIC_WORDS`, `SEMANTIC_MATCH_RATIO`, and the `SemanticTopic` type.
  - `classifySemanticIntent` now reads its safety-topic triggers and keyword sets from those tables instead of inlining them. Behaviour is unchanged — the refactor was verified against the previous implementation across 344,064 input combinations.

  The tables are the single source of truth for the gateway's semantic matching vocabulary, so the Go worker's decision engine can be generated from them rather than duplicating the keyword lists by hand.

## 0.2.0

### Minor Changes

- 2f7bd11: Add operator/CI Blueprint import support.

  - **@spctre/cli**: new `spctre blueprint import <file>` command (operator/CI only). Imports a declarative Blueprint source into the control plane as an unapproved draft via `POST /api/v1/blueprint/imports`; never approves or publishes. `--dry-run` validates the source offline.
  - **@spctre/policy-schema**: new `parseAgentBlueprintSource` export (parses a YAML/JSON Blueprint source envelope into `{ name, agentId, message, definition }`; rejects any source that pins `policyRevisionId`). Consumed by the CLI's dry-run/validation path.
  - **@spctre/sdk**: regenerated to include the new `importBlueprint` (`POST /blueprint/imports`) operation.
