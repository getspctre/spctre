from __future__ import annotations

import time
from typing import Any, Dict, Optional

from .client import SpctreClient, SpctreClientProtocol
from .models import EvaluationResult, EvidenceRecord, RuntimeTarget, TriggerKind


class SpctreHermesPlugin:
    """Spctre governance plugin for Hermes Agent.

    Install by passing an instance to Hermes's plugin registry:
        agent.register_plugin(SpctreHermesPlugin(api_key="...", base_url="https://..."))
    """

    def __init__(
        self,
        api_key: str,
        base_url: str,
        agent_id: str,
        tenant_id: str,
        workspace_id: str,
        environment: str = "production",
        timeout: float = 5.0,
        dry_run: bool = False,
        client: Optional[SpctreClientProtocol] = None,
    ) -> None:
        self.agent_id = agent_id
        self.tenant_id = tenant_id
        self.workspace_id = workspace_id
        self.environment = environment
        self.dry_run = dry_run
        self._client = client or SpctreClient(api_key=api_key, base_url=base_url, timeout=timeout)

    async def pre_tool_call(self, tool_name: str, tool_parameters: dict, context: dict) -> dict:
        """
        Called by Hermes before every tool execution (built-in + plugin tools).
        Returns {"allow": True} or {"allow": False, "reason": str}.
        """
        if self.dry_run:
            return {"allow": True}

        started = time.perf_counter()
        trigger_kind = self._derive_trigger_kind(context)
        connector = self._connector_for_tool(tool_name, context)
        action = self._action_for_tool(tool_name, context)

        try:
            evaluation = await self._client.evaluate(
                connector=connector,
                action=action,
                agent_id=self.agent_id,
                tool_parameters=tool_parameters,
                context=context,
                trigger_kind=trigger_kind,
            )
        except Exception as exc:
            evaluation = EvaluationResult(status="DENY", reason=f"Spctre evaluation failed: {exc}")

        record = self._build_evidence_record(
            connector=connector,
            action=action,
            status=evaluation.status,
            reason=evaluation.reason,
            policy_refs=evaluation.policy_refs,
            artifact_hash=evaluation.artifact_hash,
            latency_ms=self._elapsed_ms(started),
            trigger_kind=trigger_kind,
            context=context,
            raw_event={"hook": "pre_tool_call", "toolName": tool_name, "evaluation": evaluation.raw_response},
            tool_parameters=tool_parameters,
        )
        await self._client.ingest_evidence(record)

        if not evaluation.allow:
            return {"allow": False, "reason": evaluation.reason}
        return {"allow": True}

    async def pre_gateway_dispatch(self, message: dict, context: dict) -> dict:
        """
        Called by Hermes before dispatching a message to the messaging gateway.
        Evaluates and records governance decision with triggerKind="gateway_message".
        """
        if self.dry_run:
            return {"allow": True}

        started = time.perf_counter()
        connector = str(context.get("gateway") or context.get("connector") or message.get("gateway") or "hermes_gateway")
        action = str(context.get("action") or message.get("action") or "gateway.dispatch")

        try:
            evaluation = await self._client.evaluate(
                connector=connector,
                action=action,
                agent_id=self.agent_id,
                tool_parameters=message,
                context=context,
                trigger_kind="gateway_message",
            )
        except Exception as exc:
            evaluation = EvaluationResult(status="DENY", reason=f"Spctre evaluation failed: {exc}")

        record = self._build_evidence_record(
            connector=connector,
            action=action,
            status=evaluation.status,
            reason=evaluation.reason,
            policy_refs=evaluation.policy_refs,
            artifact_hash=evaluation.artifact_hash,
            latency_ms=self._elapsed_ms(started),
            trigger_kind="gateway_message",
            context=context,
            raw_event={"hook": "pre_gateway_dispatch", "message": message, "evaluation": evaluation.raw_response},
            tool_parameters=message,
        )
        await self._client.ingest_evidence(record)

        if not evaluation.allow:
            return {"allow": False, "reason": evaluation.reason}
        return {"allow": True}

    async def aclose(self) -> None:
        await self._client.aclose()

    def _build_evidence_record(
        self,
        *,
        connector: str,
        action: str,
        status: str,
        reason: str,
        policy_refs: list[str],
        artifact_hash: str,
        latency_ms: int,
        trigger_kind: TriggerKind,
        context: Dict[str, Any],
        raw_event: Dict[str, Any],
        tool_parameters: Dict[str, Any],
    ) -> EvidenceRecord:
        execution_context = self._execution_context(context)
        raw_evidence = dict(raw_event)
        raw_evidence.update(
            {
                "triggerKind": trigger_kind,
                "executionContext": execution_context,
                "parentAgentId": self._parent_agent_id(context),
                "traceId": self._trace_id(context),
            }
        )
        return EvidenceRecord(
            tenantId=self.tenant_id,
            workspaceId=self.workspace_id,
            environment=self.environment,
            runtimeTarget=RuntimeTarget(environment=self.environment),
            agentId=self.agent_id,
            connector=connector,
            action=action,
            status=status,  # type: ignore[arg-type]
            reason=reason,
            policyRefs=policy_refs,
            artifactHash=artifact_hash,
            latencyMs=latency_ms,
            rawEvidence=raw_evidence,
            triggerKind=trigger_kind,
            executionContext=execution_context,
            parentAgentId=self._parent_agent_id(context),
            traceId=self._trace_id(context),
            toolParameters=tool_parameters,
        )

    @staticmethod
    def _connector_for_tool(tool_name: str, context: Dict[str, Any]) -> str:
        return str(context.get("connector") or context.get("toolConnector") or tool_name)

    @staticmethod
    def _action_for_tool(tool_name: str, context: Dict[str, Any]) -> str:
        return str(context.get("action") or context.get("toolAction") or tool_name)

    @staticmethod
    def _derive_trigger_kind(context: Dict[str, Any]) -> TriggerKind:
        raw = str(context.get("triggerKind") or context.get("trigger") or context.get("source") or "").lower()
        if raw in {"scheduled", "schedule", "cron"}:
            return "scheduled"
        if raw in {"gateway_message", "gateway", "message"}:
            return "gateway_message"
        if context.get("scheduled") is True or context.get("cron") is True or context.get("schedule") is not None:
            return "scheduled"
        if context.get("gateway") is not None or context.get("gatewayMessage") is not None:
            return "gateway_message"
        return "interactive"

    @staticmethod
    def _execution_context(context: Dict[str, Any]) -> Dict[str, Any]:
        candidate = context.get("executionContext")
        if isinstance(candidate, dict):
            return dict(candidate)
        result: Dict[str, Any] = {}
        for key in ("backend", "sessionId", "taskId", "sandboxName"):
            if key in context:
                result[key] = context[key]
        return result

    @staticmethod
    def _parent_agent_id(context: Dict[str, Any]) -> Optional[str]:
        value = context.get("parentAgentId") or context.get("parent_agent_id") or context.get("parentAgent")
        return str(value) if value else None

    @staticmethod
    def _trace_id(context: Dict[str, Any]) -> Optional[str]:
        value = context.get("traceId") or context.get("trace_id") or context.get("taskId") or context.get("sessionId")
        return str(value) if value else None

    @staticmethod
    def _elapsed_ms(started: float) -> int:
        return max(0, int((time.perf_counter() - started) * 1000))
