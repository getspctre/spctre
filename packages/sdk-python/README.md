# spctre-sdk

Python client for the [Spctre](https://spctre.dev) policy operations control plane.

```sh
pip install spctre-sdk
```

Requires Python 3.11+.

## Usage

```python
from spctre import SpctreClient
from spctre.models import GatewayDecisionRequest

client = SpctreClient(
    base_url="https://app-staging.spctre.dev",
    token=token,
)

decision = client.gateway.decide(
    GatewayDecisionRequest(
        decision_id="d-1",
        artifact_hash="sha256:...",
        policy_context=[...],
    )
)

if decision.decision.outcome.value == "PROCEED":
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

## Domains

The client is organized by product domain, following the control-plane loop:
policy changes become published controls, controls produce enforced decisions,
decisions produce evidence, evidence supports assurance.

| Domain                | Operations                                                                              |
| --------------------- | --------------------------------------------------------------------------------------- |
| `client.gateway`      | `decide`, `resolve`, `escalation_status`, `list_escalations`, `register_agt_escalation` |
| `client.evidence`     | `ingest`, `ingest_git_checkpoint`, `forensic_query`                                     |
| `client.policy`       | `import_policy`                                                                         |
| `client.trust`        | `ingest_score`, `evaluate`, `ingest_context_budget`                                     |
| `client.verification` | `ingest`, `list`                                                                        |
| `client.bundle`       | `latest`, `retain_latest`                                                               |
| `client.compliance`   | `export`                                                                                |
| `client.approvals`    | `get`                                                                                   |

Models come from `spctre.models`. Field names are snake_case in Python and are
serialized to the API's camelCase automatically.

Operations outside these domains — SCIM, auth token rotation, blueprint import,
simulation — are reachable through `spctre._generated`, which is regenerated
wholesale from the OpenAPI spec and carries no stability promise. Anything you
find yourself needing there is a reasonable thing to request as a facade
addition.

## Errors

Every failure is raised as a `SpctreError` subclass. Generated exceptions never
escape:

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

`SpctreResponseError` is deliberately distinct from `SpctreTransportError`: it
means the client and the deployment disagree about the API contract, usually an
SDK too old or too new for the server. Reporting that as an unreachable host
would send debugging in the wrong direction.

## Testing

`transport=` accepts any `httpx.BaseTransport`, so tests need no network:

```python
import httpx
from spctre import SpctreClient

def handler(request: httpx.Request) -> httpx.Response:
    assert request.url.path == "/api/v1/gateway/decide"
    return httpx.Response(200, json={...})

client = SpctreClient(
    base_url="https://app.example.com",
    token="test-token",
    transport=httpx.MockTransport(handler),
)
```

## How this package is built

`spctre._generated` is produced by
[openapi-python-client](https://github.com/openapi-generators/openapi-python-client)
from the control plane's OpenAPI spec, at a pinned generator version. Unlike
most generated code in this repository it is **checked in**, so installing or
building the package needs no code generator, and CI can assert the committed
client still matches the spec.

## License

Apache-2.0
