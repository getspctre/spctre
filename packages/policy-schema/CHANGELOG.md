# @spctre/policy-schema

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
