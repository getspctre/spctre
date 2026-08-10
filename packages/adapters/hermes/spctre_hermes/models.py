from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field

DecisionStatus = Literal["ALLOW", "DENY", "WARN", "ESCALATE"]
TriggerKind = Literal["interactive", "scheduled", "gateway_message"]


def utc_now() -> datetime:
    return datetime.now(UTC)


def new_decision_id() -> str:
    return f"hermes-{uuid4()}"


class RuntimeTarget(BaseModel):
    stack: Literal["HERMES"] = "HERMES"
    adapter: str = "spctre-hermes"
    environment: str


class EvaluationResult(BaseModel):
    status: DecisionStatus = "ALLOW"
    reason: str = "Allowed by Spctre policy."
    policy_refs: list[str] = Field(default_factory=list, alias="policyRefs")
    artifact_hash: str = Field(default="", alias="artifactHash")
    raw_response: dict[str, Any] = Field(default_factory=dict, alias="rawResponse")

    @property
    def allow(self) -> bool:
        return self.status != "DENY"

    @classmethod
    def from_response(cls, payload: dict[str, Any]) -> EvaluationResult:
        result = payload.get("result") if isinstance(payload.get("result"), dict) else payload
        status = str(
            result.get("status")
            or result.get("decision")
            or result.get("effect")
            or result.get("action")
            or "ALLOW"
        ).upper()
        if status in {"PROCEED", "ALLOW"}:
            status = "ALLOW"
        elif status in {"ABORT", "BLOCK", "DENY"}:
            status = "DENY"
        elif status == "ESCALATE":
            status = "ESCALATE"
        elif status == "WARN":
            status = "WARN"
        else:
            status = "ALLOW"

        policy_refs = (
            result.get("matchedRefs") or result.get("policyRefs") or payload.get("policyRefs") or []
        )
        if not isinstance(policy_refs, list):
            policy_refs = [str(policy_refs)]

        return cls(
            status=status,  # type: ignore[arg-type]
            reason=str(
                result.get("reason") or payload.get("reason") or "Allowed by Spctre policy."
            ),
            policyRefs=[str(ref) for ref in policy_refs],
            artifactHash=str(payload.get("artifactHash") or result.get("artifactHash") or ""),
            rawResponse=payload,
        )


class EvidenceRecord(BaseModel):
    decision_id: str = Field(default_factory=new_decision_id, alias="decisionId")
    tenant_id: str = Field(alias="tenantId")
    workspace_id: str = Field(alias="workspaceId")
    environment: str
    runtime_target: RuntimeTarget = Field(alias="runtimeTarget")
    agent_id: str = Field(alias="agentId")
    connector: str
    action: str
    status: DecisionStatus
    reason: str
    policy_refs: list[str] = Field(default_factory=list, alias="policyRefs")
    artifact_hash: str = Field(default="", alias="artifactHash")
    latency_ms: int = Field(default=0, alias="latencyMs")
    created_at: datetime = Field(default_factory=utc_now, alias="createdAt")
    raw_evidence: dict[str, Any] = Field(default_factory=dict, alias="rawEvidence")
    trigger_kind: TriggerKind = Field(alias="triggerKind")
    execution_context: dict[str, Any] = Field(default_factory=dict, alias="executionContext")
    parent_agent_id: str | None = Field(default=None, alias="parentAgentId")
    trace_id: str | None = Field(default=None, alias="traceId")
    tool_parameters: dict[str, Any] | None = Field(default=None, alias="toolParameters")
    ingest_mode: str = Field(default="gateway", alias="ingestMode")

    model_config = {"populate_by_name": True}

    def to_payload(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, mode="json", exclude_none=True)
