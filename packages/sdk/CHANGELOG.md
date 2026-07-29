# @spctre/sdk

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
