# spctre-sdk

Python client for the [Spctre](https://spctre.dev) policy operations control plane.

```sh
pip install spctre-sdk
```

The distribution ships two packages:

| Package      | Status                                                                         |
| ------------ | ------------------------------------------------------------------------------ |
| `spctre_sdk` | The supported facade. A narrow surface with stable ergonomics.                 |
| `spctre`     | Bindings generated from the OpenAPI spec. Complete, but regenerated wholesale. |

Prefer `spctre_sdk`. Reach for `spctre` when you need an operation the facade
does not cover.

## Usage

```python
from spctre_sdk import SpctreClient
from spctre.models.gateway_decision_request import GatewayDecisionRequest

client = SpctreClient(
    base_url="https://app-staging.spctre.dev",
    token=token,
)

decision = client.gateway.decide(
    GatewayDecisionRequest(
        decisionId="d-1",
        artifactHash="sha256:...",
        policyContext="acquisition",
    )
)

if decision.decision.effect == "ALLOW":
    ...  # act
    client.evidence.ingest(record)
```

`base_url` is the deployment origin, not the API root — the client owns the
`/api/v1` path segment. Staging, production and self-hosted deployments differ
only in this value:

| Given                                 | Requests go to                                   |
| ------------------------------------- | ------------------------------------------------ |
| `https://app-staging.spctre.dev`      | `https://app-staging.spctre.dev/api/v1/...`      |
| `http://localhost:3000`               | `http://localhost:3000/api/v1/...`               |
| `https://internal.example.com/spctre` | `https://internal.example.com/spctre/api/v1/...` |

A URL that already ends in `/api/v1` is accepted as-is rather than doubled.

## Scope

The facade covers the operations a governed agent needs on its hot path:

- `client.gateway.decide(...)` — ask before acting
- `client.evidence.ingest(...)` — record what happened

Everything else is deliberately out of scope. It is not an oversight that
compliance export or SCIM are absent; use the generated package for those.

## Errors

Every failure is raised as a `SpctreError` subclass — the generated
`ApiException` never escapes:

| Raised                  | When                                        |
| ----------------------- | ------------------------------------------- |
| `SpctreAuthError`       | 401: token missing, expired, or revoked     |
| `SpctrePermissionError` | 403: token lacks the required scope         |
| `SpctreRequestError`    | other 4xx                                   |
| `SpctreServerError`     | 5xx                                         |
| `SpctreTransportError`  | no HTTP response at all (DNS, TLS, timeout) |
| `SpctreResponseError`   | answered, but the response did not parse    |

Each carries `status`, `body`, and `trace_id` lifted from the response
envelope's `meta.traceId` — quote it when reporting a problem.

## Testing

`transport=` replaces the HTTP layer, so tests need no network. Supply any
object with a `request(...)` method returning a response exposing `status`,
`read()` and `getheaders()`:

```python
client = SpctreClient(
    base_url="https://app.example.com",
    token="test-token",
    transport=RecordingTransport(),
)
```

## License

Apache-2.0
