from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.gateway_resolve_request_resolution_outcome import (
    GatewayResolveRequestResolutionOutcome,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="GatewayResolveRequest")


@_attrs_define
class GatewayResolveRequest:
    """
    Attributes:
        queue_id (str):
        resolution_outcome (GatewayResolveRequestResolutionOutcome):
        resolution_note (str | Unset):
        agent_guidance (str | Unset):
    """

    queue_id: str
    resolution_outcome: GatewayResolveRequestResolutionOutcome
    resolution_note: str | Unset = UNSET
    agent_guidance: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        queue_id = self.queue_id

        resolution_outcome = self.resolution_outcome.value

        resolution_note = self.resolution_note

        agent_guidance = self.agent_guidance

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "queueId": queue_id,
                "resolutionOutcome": resolution_outcome,
            }
        )
        if resolution_note is not UNSET:
            field_dict["resolutionNote"] = resolution_note
        if agent_guidance is not UNSET:
            field_dict["agentGuidance"] = agent_guidance

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        queue_id = d.pop("queueId")

        resolution_outcome = GatewayResolveRequestResolutionOutcome(
            d.pop("resolutionOutcome")
        )

        resolution_note = d.pop("resolutionNote", UNSET)

        agent_guidance = d.pop("agentGuidance", UNSET)

        gateway_resolve_request = cls(
            queue_id=queue_id,
            resolution_outcome=resolution_outcome,
            resolution_note=resolution_note,
            agent_guidance=agent_guidance,
        )

        gateway_resolve_request.additional_properties = d
        return gateway_resolve_request

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
