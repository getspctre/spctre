from __future__ import annotations

import asyncio
from typing import Any

from spctre_hermes import SpctreHermesPlugin
from spctre_hermes.models import EvaluationResult


class FakeClient:
    def __init__(self, result: EvaluationResult | None = None) -> None:
        self.result = result or EvaluationResult(status="ALLOW", reason="ok")
        self.evaluate_calls = []
        self.evidence_records = []

    async def evaluate(
        self,
        connector: str,
        action: str,
        agent_id: str,
        *,
        tool_parameters: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
        trigger_kind: str = "interactive",
    ) -> EvaluationResult:
        self.evaluate_calls.append(
            {
                "connector": connector,
                "action": action,
                "agent_id": agent_id,
                "tool_parameters": tool_parameters,
                "context": context,
                "trigger_kind": trigger_kind,
            }
        )
        return self.result

    async def ingest_evidence(self, record):
        self.evidence_records.append(record)

    async def aclose(self):
        pass


def make_plugin(client: FakeClient, dry_run: bool = False) -> SpctreHermesPlugin:
    return SpctreHermesPlugin(
        api_key="test-key",
        base_url="https://spctre.test",
        agent_id="agent-1",
        tenant_id="tenant-1",
        workspace_id="workspace-1",
        client=client,
        dry_run=dry_run,
    )


def test_pre_tool_call_emits_hermes_interactive_evidence():
    client = FakeClient()
    plugin = make_plugin(client)

    result = asyncio.run(plugin.pre_tool_call("shell", {"cmd": "pwd"}, {"sessionId": "session-1"}))

    assert result == {"allow": True}
    assert len(client.evidence_records) == 1
    record = client.evidence_records[0]
    assert record.runtime_target.stack == "HERMES"
    assert record.runtime_target.adapter == "spctre-hermes"
    assert record.trigger_kind == "interactive"
    assert record.ingest_mode == "gateway"


def test_pre_tool_call_scheduled_context_sets_trigger_kind():
    client = FakeClient()
    plugin = make_plugin(client)

    asyncio.run(
        plugin.pre_tool_call("browser", {"url": "https://example.com"}, {"scheduled": True})
    )

    assert client.evidence_records[0].trigger_kind == "scheduled"


def test_pre_gateway_dispatch_emits_gateway_trigger_kind():
    client = FakeClient()
    plugin = make_plugin(client)

    result = asyncio.run(plugin.pre_gateway_dispatch({"text": "hello"}, {"gateway": "slack"}))

    assert result == {"allow": True}
    assert client.evaluate_calls[0]["trigger_kind"] == "gateway_message"
    assert client.evidence_records[0].trigger_kind == "gateway_message"


def test_deny_response_blocks_pre_tool_call():
    client = FakeClient(
        EvaluationResult(status="DENY", reason="blocked by policy", policyRefs=["rule.deny"])
    )
    plugin = make_plugin(client)

    result = asyncio.run(plugin.pre_tool_call("dangerous_tool", {}, {}))

    assert result == {"allow": False, "reason": "blocked by policy"}
    assert client.evidence_records[0].status == "DENY"


def test_dry_run_skips_http_and_allows():
    client = FakeClient(EvaluationResult(status="DENY", reason="would block"))
    plugin = make_plugin(client, dry_run=True)

    result = asyncio.run(plugin.pre_tool_call("dangerous_tool", {}, {}))

    assert result == {"allow": True}
    assert client.evaluate_calls == []
    assert client.evidence_records == []
