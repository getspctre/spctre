---
"@spctre/sdk": minor
---

Add the generic evidence ingest operations to the typed client surface.

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
