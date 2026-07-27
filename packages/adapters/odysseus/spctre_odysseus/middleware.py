from __future__ import annotations

import asyncio
import uuid
from typing import Any

from .client import SpctreClient
from .models import DecisionStatus, EvaluationResult, EvidenceRecord, RuntimeTarget


class SpctreOdysseus:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        agent_id: str,
        tenant_id: str,
        workspace_id: str,
        environment: str = "production",
        dry_run: bool = False,
        client: SpctreClient | None = None,
    ) -> None:
        self.agent_id = agent_id
        self.tenant_id = tenant_id
        self.workspace_id = workspace_id
        self.environment = environment
        self.dry_run = dry_run
        self.client = client or SpctreClient(api_key=api_key, base_url=base_url)
        self.runtime_target = RuntimeTarget()
        self._background_tasks: set[asyncio.Task[None]] = set()

    async def before_call(
        self,
        tool_name: str,
        args: dict[str, Any],
        ctx: dict[str, Any],
    ) -> dict[str, Any] | None:
        if self.dry_run:
            return None

        ctx = ctx or {}
        connector = str(ctx.get("connector") or self._infer_connector(tool_name))
        action = str(ctx.get("action") or tool_name)
        trigger_kind = str(ctx.get("trigger_kind", "interactive"))
        parent_agent_id = ctx.get("parent_agent_id")

        payload = {
            "runtimeTarget": self.runtime_target.to_dict(),
            "agentId": self.agent_id,
            "tenantId": self.tenant_id,
            "workspaceId": self.workspace_id,
            "environment": self.environment,
            "connector": connector,
            "action": action,
            "toolName": tool_name,
            "args": args,
            "context": ctx,
        }
        response = await self.client.evaluate(payload)
        result = self._parse_evaluation(response)

        evidence = EvidenceRecord(
            decisionId=result.get("decisionId") or f"odysseus-{uuid.uuid4()}",
            status=result.get("status", "ALLOW"),
            runtimeTarget=self.runtime_target,
            agentId=self.agent_id,
            tenantId=self.tenant_id,
            workspaceId=self.workspace_id,
            environment=self.environment,
            connector=connector,
            action=action,
            triggerKind=trigger_kind,
            parentAgentId=str(parent_agent_id) if parent_agent_id else None,
            reason=result.get("reason"),
            policyRefs=result.get("policyRefs", []),
            rawEvidence={
                "source": "odysseus.before_call",
                "toolName": tool_name,
                "args": args,
                "ctx": ctx,
                "evaluation": result.get("raw", response),
            },
        )
        self._schedule_evidence_ingest(evidence.to_dict())

        if result.get("status") == "DENY":
            return {
                "blocked": True,
                "reason": result.get("reason") or "Spctre denied this tool call.",
            }
        return None

    async def aclose(self) -> None:
        await self.client.aclose()

    def _schedule_evidence_ingest(self, record: dict[str, Any]) -> None:
        async def ingest() -> None:
            try:
                await self.client.ingest_evidence(record)
            except Exception:
                pass

        task = asyncio.create_task(ingest())
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)

    def _parse_evaluation(self, response: dict[str, Any]) -> EvaluationResult:
        body = response.get("result")
        if not isinstance(body, dict):
            body = response

        raw_status = str(
            body.get("status")
            or body.get("decision")
            or body.get("action")
            or body.get("outcome")
            or "ALLOW"
        ).upper()
        status = self._normalize_status(raw_status)

        refs = body.get("policyRefs") or body.get("matchedRefs") or body.get("matched_rules") or []
        if not isinstance(refs, list):
            refs = []

        result: EvaluationResult = {
            "status": status,
            "reason": str(body.get("reason") or response.get("reason") or ""),
            "decisionId": str(body.get("decisionId") or response.get("decisionId") or ""),
            "policyRefs": [str(ref) for ref in refs],
            "raw": response,
        }
        return result

    def _normalize_status(self, status: str) -> DecisionStatus:
        if status == "ABORT":
            return "DENY"
        if status == "PROCEED":
            return "ALLOW"
        if status in {"ALLOW", "DENY", "WARN", "ESCALATE"}:
            return status  # type: ignore[return-value]
        return "ALLOW"

    def _infer_connector(self, tool_name: str) -> str:
        if tool_name.startswith("mcp__"):
            parts = tool_name.split("__")
            if len(parts) >= 3 and parts[1]:
                return parts[1]

        for separator in (".", ":", "/"):
            if separator in tool_name:
                candidate = tool_name.split(separator, 1)[0]
                if candidate:
                    return candidate

        return tool_name
