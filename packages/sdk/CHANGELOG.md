# @spctre/sdk

## 0.4.1

### Patch Changes

- 16e9776: Document `approvedToolParameters` as a confirmation of the reviewed decision
  arguments rather than an execution source. The value is redacted and bounded
  when the decision is recorded, so consumers should execute from the parameters
  they already hold and use this field to confirm they match what was approved.

## 0.4.0

### Minor Changes

- 2f7bd11: Add operator/CI Blueprint import support.

  - **@spctre/cli**: new `spctre blueprint import <file>` command (operator/CI only). Imports a declarative Blueprint source into the control plane as an unapproved draft via `POST /api/v1/blueprint/imports`; never approves or publishes. `--dry-run` validates the source offline.
  - **@spctre/policy-schema**: new `parseAgentBlueprintSource` export (parses a YAML/JSON Blueprint source envelope into `{ name, agentId, message, definition }`; rejects any source that pins `policyRevisionId`). Consumed by the CLI's dry-run/validation path.
  - **@spctre/sdk**: regenerated to include the new `importBlueprint` (`POST /blueprint/imports`) operation.

## 0.3.0

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

## 0.2.0

### Minor Changes

- 0d4c2a6: Harden the OpenAPI contract and regenerate SDK types:

  - Extensible free-form response objects (evidence, evaluation result, bundle,
    compliance export sections, approvals, etc.) now generate as
    `{ [key: string]: unknown }` instead of the unusable `Record<string, never>`.
  - Add the `ingestNotionGatewayEvent` operation (`POST /gateway-ingest/notion`)
    and a `gatewayWebhookSecret` security scheme on the gateway-ingest webhooks.
  - **Breaking:** remove `bulkSimulate` (`POST /evaluate/bulk`) — it was
    advertised in the contract but has no implementation.

## 0.1.1

### Patch Changes

- 55aea03: Publish the SDK as compiled JavaScript with bundled type declarations instead of TypeScript source files.
