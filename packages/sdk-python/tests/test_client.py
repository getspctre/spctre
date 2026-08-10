"""Facade behaviour, driven through httpx.MockTransport.

These exercise the real generated client — serialization, auth headers, URL
construction and deserialization all run — with only the socket replaced.
"""

import httpx
import pytest
from conftest import Recorder, a_decision_request

from spctre import (
    SpctreAuthError,
    SpctreClient,
    SpctrePermissionError,
    SpctreRequestError,
    SpctreResponseError,
    SpctreServerError,
    SpctreTransportError,
)


def make_client(
    recorder: Recorder, base_url: str = "https://app-staging.spctre.dev"
) -> SpctreClient:
    return SpctreClient(base_url=base_url, token="tok-123", transport=recorder.transport)


def test_decide_targets_the_versioned_path_on_the_configured_deployment(client, recorder):
    client.gateway.decide(a_decision_request())

    call = recorder.calls[0]
    assert call["method"] == "POST"
    assert call["url"] == "https://app-staging.spctre.dev/api/v1/gateway/decide"


def test_bearer_auth_is_applied_without_the_caller_building_headers(client, recorder):
    client.gateway.decide(a_decision_request())

    assert recorder.calls[0]["headers"]["authorization"] == "Bearer tok-123"


def test_sends_the_camel_case_wire_shape(client, recorder):
    client.gateway.decide(a_decision_request())

    body = recorder.calls[0]["body"]
    assert body["decisionId"] == "d-1"
    assert body["policyContext"][0]["branchId"] == "main"


def test_identifies_itself_with_a_versioned_user_agent(client, recorder):
    client.gateway.decide(a_decision_request())

    assert recorder.calls[0]["headers"]["user-agent"].startswith("spctre-sdk-python/")


def test_decide_returns_a_parsed_model(client):
    decision = client.gateway.decide(a_decision_request())

    assert decision.mode == "enforce"
    assert decision.decision.outcome.value == "PROCEED"
    assert decision.meta.trace_id == "trace-1"


def test_a_deployment_mounted_under_a_subpath_keeps_its_prefix(recorder):
    client = make_client(recorder, base_url="https://internal.example.com/spctre")

    client.gateway.decide(a_decision_request())

    assert recorder.calls[0]["url"] == "https://internal.example.com/spctre/api/v1/gateway/decide"


def test_query_parameters_reach_the_wire(recorder):
    recorder.payload = {
        "escalations": [],
        "meta": {"traceId": "t", "version": "2026-01", "ts": "2026-08-10T00:00:00.000Z"},
    }
    client = make_client(recorder)

    client.gateway.list_escalations(limit=5)

    assert "limit=5" in recorder.calls[0]["url"]


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (401, SpctreAuthError),
        (403, SpctrePermissionError),
        (400, SpctreRequestError),
        (404, SpctreRequestError),
        (500, SpctreServerError),
        (503, SpctreServerError),
    ],
)
def test_http_failures_surface_as_facade_errors(status, expected):
    recorder = Recorder(status=status, payload={"message": "nope", "meta": {"traceId": "trace-9"}})
    client = make_client(recorder)

    with pytest.raises(expected) as caught:
        client.gateway.decide(a_decision_request())

    assert caught.value.status == status
    assert caught.value.trace_id == "trace-9"
    assert caught.value.message == "nope"


def test_non_json_error_bodies_do_not_break_translation():
    recorder = Recorder(status=418, content=b"<html>teapot</html>")
    client = make_client(recorder)

    with pytest.raises(SpctreRequestError) as caught:
        client.gateway.decide(a_decision_request())

    assert caught.value.trace_id is None
    assert caught.value.status == 418


def test_a_network_failure_becomes_a_transport_error():
    def explode(request):
        raise httpx.ConnectError("name resolution failed")

    client = SpctreClient(
        base_url="https://app.example.com",
        token="tok",
        transport=httpx.MockTransport(explode),
    )

    with pytest.raises(SpctreTransportError) as caught:
        client.gateway.decide(a_decision_request())

    assert caught.value.status is None


def test_an_unparseable_success_response_is_not_reported_as_a_network_fault():
    # A schema mismatch means the SDK and the deployment disagree about the
    # contract. Calling that "could not reach the control plane" would send
    # debugging in the wrong direction.
    recorder = Recorder(payload={"unexpected": "shape"})
    client = make_client(recorder)

    with pytest.raises(SpctreResponseError) as caught:
        client.gateway.decide(a_decision_request())

    assert caught.value.status == 200


def test_evidence_ingest_targets_its_own_path(recorder):
    from spctre.models import (
        EvidenceIngestRequest,
        RuntimeDecisionStatus,
        RuntimeStack,
        RuntimeTarget,
    )

    recorder.payload = {
        "evidence": {"id": "ev-1"},
        "meta": {"traceId": "t", "version": "2026-01", "ts": "2026-08-10T00:00:00.000Z"},
    }
    client = make_client(recorder)

    client.evidence.ingest(
        EvidenceIngestRequest(
            decision_id="d-1",
            environment="staging",
            runtime_target=RuntimeTarget(stack=RuntimeStack.LOCAL, adapter="cli"),
            agent_id="scout",
            connector="github",
            action="read",
            status=RuntimeDecisionStatus.ALLOW,
            reason="within policy",
        )
    )

    assert recorder.calls[0]["url"] == "https://app-staging.spctre.dev/api/v1/evidence"


def test_domains_cover_the_core_product_loop(client):
    for domain in (
        "gateway",
        "evidence",
        "policy",
        "trust",
        "verification",
        "bundle",
        "compliance",
        "approvals",
    ):
        assert hasattr(client, domain), domain


def test_models_are_reachable_without_touching_the_generated_package():
    import spctre.models as models

    assert hasattr(models, "GatewayDecisionRequest")
    assert "GatewayDecisionRequest" in models.__all__


def test_rejects_an_empty_token():
    with pytest.raises(ValueError):
        SpctreClient(base_url="https://app.example.com", token="   ")


def test_repr_does_not_leak_the_token(recorder):
    client = make_client(recorder)
    assert "tok-123" not in repr(client)


def test_usable_as_a_context_manager(recorder):
    with make_client(recorder) as client:
        assert client.base_url == "https://app-staging.spctre.dev/api/v1"


def test_a_documented_error_status_with_a_non_conforming_body_still_maps_correctly():
    # 401 is a documented status for gateway/decide, so the generated layer
    # eagerly deserializes it into ApiError. An auth proxy answering with HTML
    # would blow up inside that deserialization; the caller must still get
    # SpctreAuthError rather than a JSONDecodeError from generated code.
    recorder = Recorder(status=401, content=b"<html>401 Unauthorized</html>")
    client = make_client(recorder)

    with pytest.raises(SpctreAuthError) as caught:
        client.gateway.decide(a_decision_request())

    assert caught.value.status == 401
