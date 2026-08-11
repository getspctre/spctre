# @spctre/cli

## 0.4.2

### Patch Changes

- Updated dependencies [00b605d]
  - @spctre/policy-schema@0.6.0

## 0.4.1

### Patch Changes

- 949f558: Treat a workspace with no published policy bundle as a normal starting state
  rather than a fatal error.

  `GET /api/bundle/latest` returns 404 until a workspace publishes its first
  bundle. `sync` turned that into `Sync failed: ... (404)` followed by
  `process.exit(1)`, which took down `spctre watch` on its very first poll and
  aborted `spctre init` while onboarding a fresh workspace.

  `sync` now reports the absence through a new `published` flag on `SyncResult`
  instead of exiting, and leaves any previously synced bundle file on disk
  untouched. `spctre watch` keeps polling and picks the bundle up automatically
  once one is published, reporting the state only when it changes. Heartbeats are
  skipped while no bundle is published, because a heartbeat records the artifact
  hash of the bundle an agent is running and there is none to report yet.

  Genuine failures — auth, connectivity, and any other non-404 response — remain
  fatal.

## 0.4.0

### Minor Changes

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

- Updated dependencies [7f4c51e]
- Updated dependencies [d0f2189]
- Updated dependencies [ebb2278]
- Updated dependencies [1038508]
  - @spctre/policy-schema@0.5.0

## 0.3.2

### Patch Changes

- Updated dependencies [9f9aca8]
- Updated dependencies [9f9aca8]
- Updated dependencies [7745bb8]
- Updated dependencies [9f9aca8]
  - @spctre/policy-schema@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [728c4cc]
  - @spctre/policy-schema@0.3.0

## 0.3.0

### Minor Changes

- 2f7bd11: Add operator/CI Blueprint import support.

  - **@spctre/cli**: new `spctre blueprint import <file>` command (operator/CI only). Imports a declarative Blueprint source into the control plane as an unapproved draft via `POST /api/v1/blueprint/imports`; never approves or publishes. `--dry-run` validates the source offline.
  - **@spctre/policy-schema**: new `parseAgentBlueprintSource` export (parses a YAML/JSON Blueprint source envelope into `{ name, agentId, message, definition }`; rejects any source that pins `policyRevisionId`). Consumed by the CLI's dry-run/validation path.
  - **@spctre/sdk**: regenerated to include the new `importBlueprint` (`POST /blueprint/imports`) operation.

### Patch Changes

- Updated dependencies [2f7bd11]
  - @spctre/policy-schema@0.2.0

## 0.2.1

### Patch Changes

- 8d117fb: Report the real package version from `spctre --version`. The version was a
  hardcoded `"0.1.0"` literal that never tracked the published package, so the CLI
  kept reporting `0.1.0` after every release. It (and the SARIF tool-driver
  version) now resolve from `package.json` at runtime and can no longer drift.

## 0.2.0

### Minor Changes

- f9f6c77: Publish the local-first policy import surface (#28), which merged after the
  last release:

  - `@spctre/cli`: new `spctre policy import` command that imports a local
    AGT-compatible policy document into the control plane as an unapproved draft
    revision, for operators and CI. Idempotent on the branch identity and source
    hash; never approves or publishes.
  - `@spctre/sdk`: regenerated types for the new `POST /policy/imports` operation
    (`importPolicy`, `PolicyImportRequest`), so consumers can call the endpoint
    with full typing.
