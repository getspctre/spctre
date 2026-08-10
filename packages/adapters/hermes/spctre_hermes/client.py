from __future__ import annotations

from typing import Any, Protocol

from .models import EvaluationResult, EvidenceRecord


class SpctreClientProtocol(Protocol):
    """The client surface the plugin depends on.

    Typing the plugin against this protocol (rather than the concrete
    ``SpctreClient``) lets callers inject any structurally compatible client —
    including test doubles — without a ``# type: ignore``.
    """

    async def evaluate(
        self,
        connector: str,
        action: str,
        agent_id: str,
        *,
        tool_parameters: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
        trigger_kind: str = "interactive",
    ) -> EvaluationResult: ...

    async def ingest_evidence(self, record: EvidenceRecord) -> None: ...

    async def aclose(self) -> None: ...


class SpctreClient:
    def __init__(self, api_key: str, base_url: str, timeout: float = 5.0) -> None:
        import httpx

        self._base_url = base_url.rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "x-spctre-source": "hermes",
        }
        self._client = httpx.AsyncClient(timeout=timeout, headers=self._headers)

    async def ingest_evidence(self, record: EvidenceRecord) -> None:
        response = await self._client.post(f"{self._base_url}/evidence", json=record.to_payload())
        response.raise_for_status()

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
        payload: dict[str, Any] = {
            "connector": connector,
            "action": action,
            "toolParameters": tool_parameters or {},
            "agentId": agent_id,
            "triggerKind": trigger_kind,
        }
        if context:
            domains = context.get("domains")
            if isinstance(domains, list):
                payload["domains"] = domains
            if isinstance(context.get("toolIntent"), str):
                payload["toolIntent"] = context["toolIntent"]
            if isinstance(context.get("planSummary"), str):
                payload["planSummary"] = context["planSummary"]

        response = await self._client.post(f"{self._base_url}/evaluate", json=payload)
        response.raise_for_status()
        return EvaluationResult.from_response(response.json())

    async def aclose(self) -> None:
        await self._client.aclose()
