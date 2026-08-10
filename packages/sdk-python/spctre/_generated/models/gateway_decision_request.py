from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.gateway_decision_request_risk_level import GatewayDecisionRequestRiskLevel
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.gateway_decision_request_tool_parameters import (
        GatewayDecisionRequestToolParameters,
    )
    from ..models.runtime_policy_context import RuntimePolicyContext


T = TypeVar("T", bound="GatewayDecisionRequest")


@_attrs_define
class GatewayDecisionRequest:
    """
    Attributes:
        decision_id (str):
        artifact_hash (str):
        policy_context (list[RuntimePolicyContext]):
        tenant_id (str | Unset): Optional tenant boundary hint. Empty string is treated as omitted. The x-spctre-tenant-
            id header takes precedence when both are present; otherwise inferred from the bearer token when omitted.
        workspace_id (str | Unset): Optional workspace boundary hint. Empty string is treated as omitted. The x-spctre-
            workspace-id header takes precedence when both are present; otherwise inferred from the bearer token when
            omitted.
        reason (str | Unset):
        consequence (str | Unset):
        customer_tier (str | Unset):
        confidence (float | Unset):
        amount_usd (float | Unset):
        data_sensitivity (str | Unset):
        trust_score (float | Unset):
        context_budget (int | Unset):
        risk_level (GatewayDecisionRequestRiskLevel | Unset):
        tool_intent (str | Unset): The explicitly declared intent or purpose of the tool call.
        plan_summary (str | Unset): A high-level plan summary explicitly provided by the runtime.
        tool_parameters (GatewayDecisionRequestToolParameters | Unset): The structured arguments passed to the tool.
        connector (str | Unset):
        action (str | Unset):
        agent_id (str | Unset): Runtime agent identity used to link this decision to cross-surface evidence and
            governance history.
        session_id (str | Unset): Stable runtime session identifier used for Blueprint loop safeguards.
    """

    decision_id: str
    artifact_hash: str
    policy_context: list[RuntimePolicyContext]
    tenant_id: str | Unset = UNSET
    workspace_id: str | Unset = UNSET
    reason: str | Unset = UNSET
    consequence: str | Unset = UNSET
    customer_tier: str | Unset = UNSET
    confidence: float | Unset = UNSET
    amount_usd: float | Unset = UNSET
    data_sensitivity: str | Unset = UNSET
    trust_score: float | Unset = UNSET
    context_budget: int | Unset = UNSET
    risk_level: GatewayDecisionRequestRiskLevel | Unset = UNSET
    tool_intent: str | Unset = UNSET
    plan_summary: str | Unset = UNSET
    tool_parameters: GatewayDecisionRequestToolParameters | Unset = UNSET
    connector: str | Unset = UNSET
    action: str | Unset = UNSET
    agent_id: str | Unset = UNSET
    session_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        decision_id = self.decision_id

        artifact_hash = self.artifact_hash

        policy_context = []
        for policy_context_item_data in self.policy_context:
            policy_context_item = policy_context_item_data.to_dict()
            policy_context.append(policy_context_item)

        tenant_id = self.tenant_id

        workspace_id = self.workspace_id

        reason = self.reason

        consequence = self.consequence

        customer_tier = self.customer_tier

        confidence = self.confidence

        amount_usd = self.amount_usd

        data_sensitivity = self.data_sensitivity

        trust_score = self.trust_score

        context_budget = self.context_budget

        risk_level: str | Unset = UNSET
        if not isinstance(self.risk_level, Unset):
            risk_level = self.risk_level.value

        tool_intent = self.tool_intent

        plan_summary = self.plan_summary

        tool_parameters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.tool_parameters, Unset):
            tool_parameters = self.tool_parameters.to_dict()

        connector = self.connector

        action = self.action

        agent_id = self.agent_id

        session_id = self.session_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "decisionId": decision_id,
                "artifactHash": artifact_hash,
                "policyContext": policy_context,
            }
        )
        if tenant_id is not UNSET:
            field_dict["tenantId"] = tenant_id
        if workspace_id is not UNSET:
            field_dict["workspaceId"] = workspace_id
        if reason is not UNSET:
            field_dict["reason"] = reason
        if consequence is not UNSET:
            field_dict["consequence"] = consequence
        if customer_tier is not UNSET:
            field_dict["customerTier"] = customer_tier
        if confidence is not UNSET:
            field_dict["confidence"] = confidence
        if amount_usd is not UNSET:
            field_dict["amountUsd"] = amount_usd
        if data_sensitivity is not UNSET:
            field_dict["dataSensitivity"] = data_sensitivity
        if trust_score is not UNSET:
            field_dict["trustScore"] = trust_score
        if context_budget is not UNSET:
            field_dict["contextBudget"] = context_budget
        if risk_level is not UNSET:
            field_dict["riskLevel"] = risk_level
        if tool_intent is not UNSET:
            field_dict["toolIntent"] = tool_intent
        if plan_summary is not UNSET:
            field_dict["planSummary"] = plan_summary
        if tool_parameters is not UNSET:
            field_dict["toolParameters"] = tool_parameters
        if connector is not UNSET:
            field_dict["connector"] = connector
        if action is not UNSET:
            field_dict["action"] = action
        if agent_id is not UNSET:
            field_dict["agentId"] = agent_id
        if session_id is not UNSET:
            field_dict["sessionId"] = session_id

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.gateway_decision_request_tool_parameters import (
            GatewayDecisionRequestToolParameters,
        )
        from ..models.runtime_policy_context import RuntimePolicyContext

        d = dict(src_dict)
        decision_id = d.pop("decisionId")

        artifact_hash = d.pop("artifactHash")

        policy_context = []
        _policy_context = d.pop("policyContext")
        for policy_context_item_data in _policy_context:
            policy_context_item = RuntimePolicyContext.from_dict(
                policy_context_item_data
            )

            policy_context.append(policy_context_item)

        tenant_id = d.pop("tenantId", UNSET)

        workspace_id = d.pop("workspaceId", UNSET)

        reason = d.pop("reason", UNSET)

        consequence = d.pop("consequence", UNSET)

        customer_tier = d.pop("customerTier", UNSET)

        confidence = d.pop("confidence", UNSET)

        amount_usd = d.pop("amountUsd", UNSET)

        data_sensitivity = d.pop("dataSensitivity", UNSET)

        trust_score = d.pop("trustScore", UNSET)

        context_budget = d.pop("contextBudget", UNSET)

        _risk_level = d.pop("riskLevel", UNSET)
        risk_level: GatewayDecisionRequestRiskLevel | Unset
        if isinstance(_risk_level, Unset):
            risk_level = UNSET
        else:
            risk_level = GatewayDecisionRequestRiskLevel(_risk_level)

        tool_intent = d.pop("toolIntent", UNSET)

        plan_summary = d.pop("planSummary", UNSET)

        _tool_parameters = d.pop("toolParameters", UNSET)
        tool_parameters: GatewayDecisionRequestToolParameters | Unset
        if isinstance(_tool_parameters, Unset):
            tool_parameters = UNSET
        else:
            tool_parameters = GatewayDecisionRequestToolParameters.from_dict(
                _tool_parameters
            )

        connector = d.pop("connector", UNSET)

        action = d.pop("action", UNSET)

        agent_id = d.pop("agentId", UNSET)

        session_id = d.pop("sessionId", UNSET)

        gateway_decision_request = cls(
            decision_id=decision_id,
            artifact_hash=artifact_hash,
            policy_context=policy_context,
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            reason=reason,
            consequence=consequence,
            customer_tier=customer_tier,
            confidence=confidence,
            amount_usd=amount_usd,
            data_sensitivity=data_sensitivity,
            trust_score=trust_score,
            context_budget=context_budget,
            risk_level=risk_level,
            tool_intent=tool_intent,
            plan_summary=plan_summary,
            tool_parameters=tool_parameters,
            connector=connector,
            action=action,
            agent_id=agent_id,
            session_id=session_id,
        )

        gateway_decision_request.additional_properties = d
        return gateway_decision_request

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
