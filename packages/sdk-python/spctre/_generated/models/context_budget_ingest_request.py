from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.context_budget_ingest_request_event_type import (
    ContextBudgetIngestRequestEventType,
)
from ..models.context_budget_ingest_request_governance_action import (
    ContextBudgetIngestRequestGovernanceAction,
)
from ..models.runtime_stack import RuntimeStack
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.context_budget_ingest_request_context_source_mix import (
        ContextBudgetIngestRequestContextSourceMix,
    )


T = TypeVar("T", bound="ContextBudgetIngestRequest")


@_attrs_define
class ContextBudgetIngestRequest:
    """
    Attributes:
        session_id (str):
        agent_id (str):
        environment (str):
        runtime_stack (RuntimeStack):
        event_type (ContextBudgetIngestRequestEventType):
        token_count (int):
        token_delta (int | Unset):
        context_source_mix (ContextBudgetIngestRequestContextSourceMix | Unset):
        budget_limit (int | Unset):
        budget_utilization (float | Unset):
        governance_action (ContextBudgetIngestRequestGovernanceAction | Unset):
        policy_ref (str | Unset):
    """

    session_id: str
    agent_id: str
    environment: str
    runtime_stack: RuntimeStack
    event_type: ContextBudgetIngestRequestEventType
    token_count: int
    token_delta: int | Unset = UNSET
    context_source_mix: ContextBudgetIngestRequestContextSourceMix | Unset = UNSET
    budget_limit: int | Unset = UNSET
    budget_utilization: float | Unset = UNSET
    governance_action: ContextBudgetIngestRequestGovernanceAction | Unset = UNSET
    policy_ref: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        session_id = self.session_id

        agent_id = self.agent_id

        environment = self.environment

        runtime_stack = self.runtime_stack.value

        event_type = self.event_type.value

        token_count = self.token_count

        token_delta = self.token_delta

        context_source_mix: dict[str, Any] | Unset = UNSET
        if not isinstance(self.context_source_mix, Unset):
            context_source_mix = self.context_source_mix.to_dict()

        budget_limit = self.budget_limit

        budget_utilization = self.budget_utilization

        governance_action: str | Unset = UNSET
        if not isinstance(self.governance_action, Unset):
            governance_action = self.governance_action.value

        policy_ref = self.policy_ref

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "sessionId": session_id,
                "agentId": agent_id,
                "environment": environment,
                "runtimeStack": runtime_stack,
                "eventType": event_type,
                "tokenCount": token_count,
            }
        )
        if token_delta is not UNSET:
            field_dict["tokenDelta"] = token_delta
        if context_source_mix is not UNSET:
            field_dict["contextSourceMix"] = context_source_mix
        if budget_limit is not UNSET:
            field_dict["budgetLimit"] = budget_limit
        if budget_utilization is not UNSET:
            field_dict["budgetUtilization"] = budget_utilization
        if governance_action is not UNSET:
            field_dict["governanceAction"] = governance_action
        if policy_ref is not UNSET:
            field_dict["policyRef"] = policy_ref

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.context_budget_ingest_request_context_source_mix import (
            ContextBudgetIngestRequestContextSourceMix,
        )

        d = dict(src_dict)
        session_id = d.pop("sessionId")

        agent_id = d.pop("agentId")

        environment = d.pop("environment")

        runtime_stack = RuntimeStack(d.pop("runtimeStack"))

        event_type = ContextBudgetIngestRequestEventType(d.pop("eventType"))

        token_count = d.pop("tokenCount")

        token_delta = d.pop("tokenDelta", UNSET)

        _context_source_mix = d.pop("contextSourceMix", UNSET)
        context_source_mix: ContextBudgetIngestRequestContextSourceMix | Unset
        if isinstance(_context_source_mix, Unset):
            context_source_mix = UNSET
        else:
            context_source_mix = ContextBudgetIngestRequestContextSourceMix.from_dict(
                _context_source_mix
            )

        budget_limit = d.pop("budgetLimit", UNSET)

        budget_utilization = d.pop("budgetUtilization", UNSET)

        _governance_action = d.pop("governanceAction", UNSET)
        governance_action: ContextBudgetIngestRequestGovernanceAction | Unset
        if isinstance(_governance_action, Unset):
            governance_action = UNSET
        else:
            governance_action = ContextBudgetIngestRequestGovernanceAction(
                _governance_action
            )

        policy_ref = d.pop("policyRef", UNSET)

        context_budget_ingest_request = cls(
            session_id=session_id,
            agent_id=agent_id,
            environment=environment,
            runtime_stack=runtime_stack,
            event_type=event_type,
            token_count=token_count,
            token_delta=token_delta,
            context_source_mix=context_source_mix,
            budget_limit=budget_limit,
            budget_utilization=budget_utilization,
            governance_action=governance_action,
            policy_ref=policy_ref,
        )

        context_budget_ingest_request.additional_properties = d
        return context_budget_ingest_request

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
