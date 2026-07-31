# @spctre/sdk

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
