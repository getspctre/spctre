import json

import httpx
import pytest

from spctre import SpctreClient
from spctre.models import (
    GatewayDecisionRequest,
    RuntimePolicyContext,
    RuntimePolicyContextScope,
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


class Recorder:
    """Captures what the generated client put on the wire."""

    def __init__(self, status=200, payload=None, content=None):
        self.status = status
        self.payload = DECISION_RESPONSE if payload is None else payload
        self.content = content
        self.calls = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = None
        if request.content:
            try:
                body = json.loads(request.content)
            except ValueError:
                body = request.content
        self.calls.append(
            {
                "method": request.method,
                "url": str(request.url),
                "headers": request.headers,
                "body": body,
            }
        )
        if self.content is not None:
            return httpx.Response(self.status, content=self.content)
        return httpx.Response(self.status, json=self.payload)

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)


@pytest.fixture
def recorder():
    return Recorder()


@pytest.fixture
def client(recorder):
    return SpctreClient(
        base_url="https://app-staging.spctre.dev",
        token="tok-123",
        transport=recorder.transport,
    )


def a_decision_request() -> GatewayDecisionRequest:
    return GatewayDecisionRequest(
        decision_id="d-1",
        artifact_hash="sha256:" + "0" * 64,
        policy_context=[
            RuntimePolicyContext(
                scope=RuntimePolicyContextScope.WORKSPACE,
                branch_id="main",
                revision_id="rev-1",
                artifact_hash="sha256:" + "0" * 64,
            )
        ],
    )
