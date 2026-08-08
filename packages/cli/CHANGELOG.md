# @spctre/cli

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
