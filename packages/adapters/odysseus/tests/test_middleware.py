from __future__ import annotations

import asyncio
from typing import Any

import pytest

from spctre_odysseus import SpctreOdysseus


class FakeClient:
    def __init__(self, response: dict[str, Any], *, ingest_error: Exception | None = None) -> None:
        self.response = response
        self.ingest_error = ingest_error
        self.evaluate_calls: list[dict[str, Any]] = []
        self.evidence_calls: list[dict[str, Any]] = []

    async def evaluate(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.evaluate_calls.append(payload)
        return self.response

    async def ingest_evidence(self, record: dict[str, Any]) -> None:
        self.evidence_calls.append(record)
        if self.ingest_error:
            raise self.ingest_error

    async def aclose(self) -> None:
        return None


def middleware(client: FakeClient, *, dry_run: bool = False) -> SpctreOdysseus:
    return SpctreOdysseus(
        api_key="test-key",
        base_url="https://spctre.test",
        agent_id="agent-1",
        tenant_id="tenant-1",
        workspace_id="workspace-1",
        environment="test",
        dry_run=dry_run,
        client=client,  # type: ignore[arg-type]
    )


@pytest.mark.asyncio
async def test_allow_path_returns_none() -> None:
    client = FakeClient({"result": {"status": "ALLOW", "reason": "ok", "decisionId": "dec-1"}})
    spctre = middleware(client)

    result = await spctre.before_call("github.create_issue", {"title": "Bug"}, {})
    await asyncio.sleep(0)

    assert result is None
    assert client.evaluate_calls[0]["runtimeTarget"] == {
        "stack": "ODYSSEUS",
        "adapter": "spctre-odysseus",
    }
    assert client.evidence_calls[0]["status"] == "ALLOW"
    assert client.evidence_calls[0]["runtimeTarget"]["stack"] == "ODYSSEUS"
    assert client.evidence_calls[0]["connector"] == "github"
    assert client.evidence_calls[0]["action"] == "github.create_issue"
    assert client.evidence_calls[0]["triggerKind"] == "interactive"
    assert client.evidence_calls[0]["rawEvidence"]["source"] == "odysseus.before_call"
    assert client.evidence_calls[0]["ingestMode"] == "gateway"


@pytest.mark.asyncio
async def test_deny_path_returns_blocked_dict() -> None:
    client = FakeClient({"result": {"status": "DENY", "reason": "not permitted", "decisionId": "dec-2"}})
    spctre = middleware(client)

    result = await spctre.before_call("mcp__stripe__refund", {"amount": 100}, {"action": "refund"})
    await asyncio.sleep(0)

    assert result == {"blocked": True, "reason": "not permitted"}
    assert client.evidence_calls[0]["status"] == "DENY"
    assert client.evidence_calls[0]["connector"] == "stripe"
    assert client.evidence_calls[0]["action"] == "refund"


@pytest.mark.asyncio
async def test_ingest_errors_are_swallowed() -> None:
    client = FakeClient(
        {"result": {"status": "ALLOW", "reason": "ok", "decisionId": "dec-3"}},
        ingest_error=RuntimeError("ingest unavailable"),
    )
    spctre = middleware(client)

    result = await spctre.before_call("calendar.create_event", {}, {})
    await asyncio.sleep(0)

    assert result is None
    assert len(client.evidence_calls) == 1


@pytest.mark.asyncio
async def test_dry_run_skips_network() -> None:
    client = FakeClient({"result": {"status": "DENY", "reason": "would block", "decisionId": "dec-4"}})
    spctre = middleware(client, dry_run=True)

    result = await spctre.before_call("shell.run", {"cmd": "ls"}, {})
    await asyncio.sleep(0)

    assert result is None
    assert client.evaluate_calls == []
    assert client.evidence_calls == []
