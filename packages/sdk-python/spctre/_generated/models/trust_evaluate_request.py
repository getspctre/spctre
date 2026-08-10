from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.runtime_stack import RuntimeStack
from ..models.trust_evaluate_request_consequence_tier import (
    TrustEvaluateRequestConsequenceTier,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="TrustEvaluateRequest")


@_attrs_define
class TrustEvaluateRequest:
    """
    Attributes:
        trust_score (float | Unset):
        context_tokens (int | Unset):
        budget_limit (int | Unset):
        agent_class (str | Unset):
        environment (str | Unset):
        connector (str | Unset):
        consequence_tier (TrustEvaluateRequestConsequenceTier | Unset):
        session_id (str | Unset):
        agent_id (str | Unset):
        runtime_stack (RuntimeStack | Unset):
    """

    trust_score: float | Unset = UNSET
    context_tokens: int | Unset = UNSET
    budget_limit: int | Unset = UNSET
    agent_class: str | Unset = UNSET
    environment: str | Unset = UNSET
    connector: str | Unset = UNSET
    consequence_tier: TrustEvaluateRequestConsequenceTier | Unset = UNSET
    session_id: str | Unset = UNSET
    agent_id: str | Unset = UNSET
    runtime_stack: RuntimeStack | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        trust_score = self.trust_score

        context_tokens = self.context_tokens

        budget_limit = self.budget_limit

        agent_class = self.agent_class

        environment = self.environment

        connector = self.connector

        consequence_tier: str | Unset = UNSET
        if not isinstance(self.consequence_tier, Unset):
            consequence_tier = self.consequence_tier.value

        session_id = self.session_id

        agent_id = self.agent_id

        runtime_stack: str | Unset = UNSET
        if not isinstance(self.runtime_stack, Unset):
            runtime_stack = self.runtime_stack.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if trust_score is not UNSET:
            field_dict["trustScore"] = trust_score
        if context_tokens is not UNSET:
            field_dict["contextTokens"] = context_tokens
        if budget_limit is not UNSET:
            field_dict["budgetLimit"] = budget_limit
        if agent_class is not UNSET:
            field_dict["agentClass"] = agent_class
        if environment is not UNSET:
            field_dict["environment"] = environment
        if connector is not UNSET:
            field_dict["connector"] = connector
        if consequence_tier is not UNSET:
            field_dict["consequenceTier"] = consequence_tier
        if session_id is not UNSET:
            field_dict["sessionId"] = session_id
        if agent_id is not UNSET:
            field_dict["agentId"] = agent_id
        if runtime_stack is not UNSET:
            field_dict["runtimeStack"] = runtime_stack

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        trust_score = d.pop("trustScore", UNSET)

        context_tokens = d.pop("contextTokens", UNSET)

        budget_limit = d.pop("budgetLimit", UNSET)

        agent_class = d.pop("agentClass", UNSET)

        environment = d.pop("environment", UNSET)

        connector = d.pop("connector", UNSET)

        _consequence_tier = d.pop("consequenceTier", UNSET)
        consequence_tier: TrustEvaluateRequestConsequenceTier | Unset
        if isinstance(_consequence_tier, Unset):
            consequence_tier = UNSET
        else:
            consequence_tier = TrustEvaluateRequestConsequenceTier(_consequence_tier)

        session_id = d.pop("sessionId", UNSET)

        agent_id = d.pop("agentId", UNSET)

        _runtime_stack = d.pop("runtimeStack", UNSET)
        runtime_stack: RuntimeStack | Unset
        if isinstance(_runtime_stack, Unset):
            runtime_stack = UNSET
        else:
            runtime_stack = RuntimeStack(_runtime_stack)

        trust_evaluate_request = cls(
            trust_score=trust_score,
            context_tokens=context_tokens,
            budget_limit=budget_limit,
            agent_class=agent_class,
            environment=environment,
            connector=connector,
            consequence_tier=consequence_tier,
            session_id=session_id,
            agent_id=agent_id,
            runtime_stack=runtime_stack,
        )

        trust_evaluate_request.additional_properties = d
        return trust_evaluate_request

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
