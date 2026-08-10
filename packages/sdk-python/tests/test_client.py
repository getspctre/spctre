"""End-to-end facade behaviour, driven through an injected transport.

These exercise the real generated client — serialization, auth headers, URL
construction and deserialization all run — with only the socket replaced.
"""

import json

import pytest
from spctre.models.evidence_ingest_request import EvidenceIngestRequest
from spctre.models.runtime_target import RuntimeTarget
from spctre.models.gateway_decision_request import GatewayDecisionRequest
from spctre.models.runtime_policy_context import RuntimePolicyContext

from spctre_sdk import (
    SpctreAuthError,
    SpctreClient,
    SpctreResponseError,
    SpctreServerError,
)

DECISION_RESPONSE = {
    "gatewayEnabled": True,
    "mode": "enforce",
    "persisted": True,
    "queued": False,
    "decision": {
        "outcome": "PROCEED",
        "reason": "within policy",
        "riskLevel": "LOW",
        "shouldQueue": False,
    },
    "meta": {"traceId": "trace-1", "version": "2026-01", "ts": "2026-08-10T00:00:00.000Z"},
}


class FakeResponse:
    """Mimics the generated RESTResponse surface."""

    def __init__(self, status, payload):
        self.status = status
        self.reason = "OK" if status < 400 else "Error"
        self.data = json.dumps(payload).encode("utf-8")

    def read(self):
        return self.data

    def getheaders(self):
        return {"Content-Type": "application/json"}

    def getheader(self, name, default=None):
        return self.getheaders().get(name, default)


class RecordingTransport:
    """Captures the request the generated client would have put on the wire."""

    def __init__(self, status=200, payload=None):
        self.status = status
        self.payload = payload if payload is not None else DECISION_RESPONSE
        self.calls = []

    def request(self, method, url, headers=None, body=None, post_params=None, _request_timeout=None):
        self.calls.append(
            {
                "method": method,
                "url": url,
                "headers": headers or {},
                "body": body,
                "timeout": _request_timeout,
            }
        )
        return FakeResponse(self.status, self.payload)


def a_decision_request():
    return GatewayDecisionRequest(
        decisionId="d-1",
        artifactHash="sha256:" + "0" * 64,
        policyContext=[
            RuntimePolicyContext(
                scope="WORKSPACE",
                branchId="main",
                revisionId="rev-1",
                artifactHash="sha256:" + "0" * 64,
            )
        ],
    )


def test_decide_targets_the_versioned_path_on_the_configured_deployment():
    transport = RecordingTransport()
    client = SpctreClient(
        base_url="https://app-staging.spctre.dev",
        token="tok-123",
        transport=transport,
    )

    client.gateway.decide(a_decision_request())

    call = transport.calls[0]
    assert call["method"] == "POST"
    assert call["url"] == "https://app-staging.spctre.dev/api/v1/gateway/decide"


def test_bearer_auth_is_applied_without_the_caller_building_headers():
    transport = RecordingTransport()
    client = SpctreClient(base_url="https://app.example.com", token="tok-123", transport=transport)

    client.gateway.decide(a_decision_request())

    assert transport.calls[0]["headers"]["Authorization"] == "Bearer tok-123"


def test_decide_returns_a_deserialized_model():
    client = SpctreClient(
        base_url="https://app.example.com", token="tok", transport=RecordingTransport()
    )

    decision = client.gateway.decide(a_decision_request())

    assert decision.mode == "enforce"
    assert decision.decision.outcome == "PROCEED"
    assert decision.meta.trace_id == "trace-1"


def test_evidence_ingest_targets_its_own_path():
    transport = RecordingTransport(
        payload={
            "evidence": {"id": "ev-1"},
            "meta": {"traceId": "t", "version": "2026-01", "ts": "2026-08-10T00:00:00.000Z"},
        }
    )
    client = SpctreClient(base_url="https://app.example.com", token="tok", transport=transport)

    client.evidence.ingest(
        EvidenceIngestRequest(
            decisionId="d-1",
            environment="staging",
            runtimeTarget=RuntimeTarget(stack="LOCAL", adapter="cli"),
            agentId="scout",
            connector="github",
            action="read",
            status="ALLOW",
            reason="within policy",
        )
    )

    assert transport.calls[0]["url"] == "https://app.example.com/api/v1/evidence"


def test_a_deployment_mounted_under_a_subpath_keeps_its_prefix():
    transport = RecordingTransport()
    client = SpctreClient(
        base_url="https://internal.example.com/spctre", token="tok", transport=transport
    )

    client.gateway.decide(a_decision_request())

    assert transport.calls[0]["url"] == "https://internal.example.com/spctre/api/v1/gateway/decide"


def test_http_failures_surface_as_facade_errors_not_generated_ones():
    transport = RecordingTransport(status=401, payload={"message": "token revoked", "meta": {"traceId": "trace-9"}})
    client = SpctreClient(base_url="https://app.example.com", token="tok", transport=transport)

    with pytest.raises(SpctreAuthError) as caught:
        client.gateway.decide(a_decision_request())

    assert caught.value.status == 401
    assert caught.value.trace_id == "trace-9"
    assert caught.value.message == "token revoked"


def test_server_failures_map_to_server_error():
    transport = RecordingTransport(status=503, payload={"message": "unavailable"})
    client = SpctreClient(base_url="https://app.example.com", token="tok", transport=transport)

    with pytest.raises(SpctreServerError):
        client.gateway.decide(a_decision_request())


def test_per_call_timeout_overrides_the_client_default():
    transport = RecordingTransport()
    client = SpctreClient(
        base_url="https://app.example.com", token="tok", transport=transport, timeout=30.0
    )

    client.gateway.decide(a_decision_request(), timeout=1.5)

    assert transport.calls[0]["timeout"] == 1.5


def test_client_default_timeout_is_applied():
    transport = RecordingTransport()
    client = SpctreClient(
        base_url="https://app.example.com", token="tok", transport=transport, timeout=7.0
    )

    client.gateway.decide(a_decision_request())

    assert transport.calls[0]["timeout"] == 7.0


def test_rejects_an_empty_token():
    with pytest.raises(ValueError):
        SpctreClient(base_url="https://app.example.com", token="   ")


def test_repr_does_not_leak_the_token():
    client = SpctreClient(
        base_url="https://app.example.com", token="super-secret", transport=RecordingTransport()
    )
    assert "super-secret" not in repr(client)


def test_usable_as_a_context_manager():
    with SpctreClient(
        base_url="https://app.example.com", token="tok", transport=RecordingTransport()
    ) as client:
        assert client.base_url == "https://app.example.com/api/v1"


def test_an_unparseable_success_response_is_not_reported_as_a_network_fault():
    # A schema mismatch means the SDK and the deployment disagree about the
    # contract. Calling that "could not reach the control plane" would send
    # debugging in the wrong direction.
    transport = RecordingTransport(payload={"unexpected": "shape"})
    client = SpctreClient(base_url="https://app.example.com", token="tok", transport=transport)

    with pytest.raises(SpctreResponseError):
        client.gateway.decide(a_decision_request())
