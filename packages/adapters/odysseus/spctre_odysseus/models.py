from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict


RuntimeStack = Literal["ODYSSEUS"]
DecisionStatus = Literal["ALLOW", "DENY", "WARN", "ESCALATE"]


@dataclass(frozen=True)
class RuntimeTarget:
    stack: RuntimeStack = "ODYSSEUS"
    adapter: str = "spctre-odysseus"

    def to_dict(self) -> dict[str, str]:
        return {"stack": self.stack, "adapter": self.adapter}


class EvaluationResult(TypedDict, total=False):
    status: DecisionStatus
    reason: str
    decisionId: str
    policyRefs: list[str]
    raw: dict[str, Any]


@dataclass(frozen=True)
class EvidenceRecord:
    decisionId: str
    status: DecisionStatus
    runtimeTarget: RuntimeTarget
    agentId: str
    tenantId: str
    workspaceId: str
    environment: str
    connector: str
    action: str
    triggerKind: str = "interactive"
    reason: str | None = None
    parentAgentId: str | None = None
    policyRefs: list[str] = field(default_factory=list)
    rawEvidence: dict[str, Any] = field(default_factory=dict)
    ingestMode: str = "gateway"

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "decisionId": self.decisionId,
            "status": self.status,
            "runtimeTarget": self.runtimeTarget.to_dict(),
            "agentId": self.agentId,
            "tenantId": self.tenantId,
            "workspaceId": self.workspaceId,
            "environment": self.environment,
            "connector": self.connector,
            "action": self.action,
            "triggerKind": self.triggerKind,
            "policyRefs": self.policyRefs,
            "rawEvidence": self.rawEvidence,
            "ingestMode": self.ingestMode,
        }
        if self.reason:
            data["reason"] = self.reason
        if self.parentAgentId:
            data["parentAgentId"] = self.parentAgentId
        return data
