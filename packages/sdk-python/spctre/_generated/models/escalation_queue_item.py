from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="EscalationQueueItem")


@_attrs_define
class EscalationQueueItem:
    """An open escalation queue item awaiting human review.

    Attributes:
        id (str | Unset):
        decision_id (str | Unset):
        outcome (str | Unset):
        risk_level (str | Unset):
        created_at (datetime.datetime | Unset):
        sla_deadline_at (datetime.datetime | Unset):
        resolution_outcome (None | str | Unset):
        resolved_at (datetime.datetime | None | Unset):
        agent_guidance (None | str | Unset):
    """

    id: str | Unset = UNSET
    decision_id: str | Unset = UNSET
    outcome: str | Unset = UNSET
    risk_level: str | Unset = UNSET
    created_at: datetime.datetime | Unset = UNSET
    sla_deadline_at: datetime.datetime | Unset = UNSET
    resolution_outcome: None | str | Unset = UNSET
    resolved_at: datetime.datetime | None | Unset = UNSET
    agent_guidance: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        decision_id = self.decision_id

        outcome = self.outcome

        risk_level = self.risk_level

        created_at: str | Unset = UNSET
        if not isinstance(self.created_at, Unset):
            created_at = self.created_at.isoformat()

        sla_deadline_at: str | Unset = UNSET
        if not isinstance(self.sla_deadline_at, Unset):
            sla_deadline_at = self.sla_deadline_at.isoformat()

        resolution_outcome: None | str | Unset
        if isinstance(self.resolution_outcome, Unset):
            resolution_outcome = UNSET
        else:
            resolution_outcome = self.resolution_outcome

        resolved_at: None | str | Unset
        if isinstance(self.resolved_at, Unset):
            resolved_at = UNSET
        elif isinstance(self.resolved_at, datetime.datetime):
            resolved_at = self.resolved_at.isoformat()
        else:
            resolved_at = self.resolved_at

        agent_guidance: None | str | Unset
        if isinstance(self.agent_guidance, Unset):
            agent_guidance = UNSET
        else:
            agent_guidance = self.agent_guidance

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if decision_id is not UNSET:
            field_dict["decisionId"] = decision_id
        if outcome is not UNSET:
            field_dict["outcome"] = outcome
        if risk_level is not UNSET:
            field_dict["riskLevel"] = risk_level
        if created_at is not UNSET:
            field_dict["createdAt"] = created_at
        if sla_deadline_at is not UNSET:
            field_dict["slaDeadlineAt"] = sla_deadline_at
        if resolution_outcome is not UNSET:
            field_dict["resolutionOutcome"] = resolution_outcome
        if resolved_at is not UNSET:
            field_dict["resolvedAt"] = resolved_at
        if agent_guidance is not UNSET:
            field_dict["agentGuidance"] = agent_guidance

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        id = d.pop("id", UNSET)

        decision_id = d.pop("decisionId", UNSET)

        outcome = d.pop("outcome", UNSET)

        risk_level = d.pop("riskLevel", UNSET)

        _created_at = d.pop("createdAt", UNSET)
        created_at: datetime.datetime | Unset
        if isinstance(_created_at, Unset):
            created_at = UNSET
        else:
            created_at = datetime.datetime.fromisoformat(_created_at)

        _sla_deadline_at = d.pop("slaDeadlineAt", UNSET)
        sla_deadline_at: datetime.datetime | Unset
        if isinstance(_sla_deadline_at, Unset):
            sla_deadline_at = UNSET
        else:
            sla_deadline_at = datetime.datetime.fromisoformat(_sla_deadline_at)

        def _parse_resolution_outcome(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        resolution_outcome = _parse_resolution_outcome(
            d.pop("resolutionOutcome", UNSET)
        )

        def _parse_resolved_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                resolved_at_type_0 = datetime.datetime.fromisoformat(data)

                return resolved_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        resolved_at = _parse_resolved_at(d.pop("resolvedAt", UNSET))

        def _parse_agent_guidance(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        agent_guidance = _parse_agent_guidance(d.pop("agentGuidance", UNSET))

        escalation_queue_item = cls(
            id=id,
            decision_id=decision_id,
            outcome=outcome,
            risk_level=risk_level,
            created_at=created_at,
            sla_deadline_at=sla_deadline_at,
            resolution_outcome=resolution_outcome,
            resolved_at=resolved_at,
            agent_guidance=agent_guidance,
        )

        escalation_queue_item.additional_properties = d
        return escalation_queue_item

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
