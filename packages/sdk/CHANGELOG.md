# @spctre/sdk

## 0.7.0

### Minor Changes

- e47527e: Add bindings for nine governed reads that the API already served but never
  described: workspaces, members, the approval queue, compliance status, an
  agent's audit summary, trust history, identity events, workflow configuration,
  and the MCP gateway-ingest receiver.

  Each is now served at `/api/v1` alongside its unversioned route, so a client
  can reach them at the versioned base like every other documented endpoint.

- af40835: Add the Docker AI Governance ingest endpoint to the generated bindings, and
  correct four documented paths that the API did not actually serve at their
  published URL.

  `/bundle/latest/custody`, `/evidence/policy-artifacts`,
  `/evidence/policy-artifacts/{contentHash}`, and `/gateway/escalations/agt` were
  described in the spec, and so present in the SDK, while only existing on the
  unversioned routes — calling them through the client hit a URL with nothing
  behind it. They are now served at `/api/v1` like every other documented path.

### Patch Changes

- 9032831: Declare that `gatewayResolve` authenticates with a browser session rather than a
  bearer key. Its description has always said so — resolving an escalation is a
  human-in-the-loop decision the handler will not delegate to a service account —
  but the operation inherited the global bearer requirement, so the generated
  bindings advertised a delegation the API refuses.

## 0.6.0

### Minor Changes

- 9e581ec: Add a generic, signable publication-attestation contract and evidence-ingest API for immutable, content-addressed publication facts.

## 0.5.0

### Minor Changes

- 6ffe2e5: Add the generic evidence ingest operations to the typed client surface.

  - `ingestGenericJsonEvidence`, `ingestGenericNdjsonEvidence`,
    `ingestCloudEventEvidence`, and `ingestOtlpLogs` cover the provider-neutral
    receivers. Each requires an `evidence:write` bearer token and the
    `x-spctre-integration-id` header naming the integration that token is bound
    to; a token may only submit to its own integration.
  - Batch receivers report per-record outcomes, so `207` is a normal response and
    is typed alongside `200` (every record a duplicate) and `201` (accepted).
  - `413`, `415`, `429`, and `503` are typed as well: requests are capped at 1 MiB
    and 500 records, compressed bodies are rejected, and callers are expected to
    respect `Retry-After` on a throttled receiver.

## 0.4.2

### Patch Changes

- 9f9aca8: Publish typed bindings for the scoped evidence-export and policy-content
  artifact endpoints so SDK consumers can retain and read byte-exact policy
  artifacts.

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
