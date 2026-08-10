from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.api_meta import ApiMeta
    from ..models.gateway_decision import GatewayDecision


T = TypeVar("T", bound="GatewayDecisionResponse")


@_attrs_define
class GatewayDecisionResponse:
    """
    Attributes:
        gateway_enabled (bool):
        mode (str):
        persisted (bool):
        queued (bool):
        decision (GatewayDecision):
        meta (ApiMeta):
    """

    gateway_enabled: bool
    mode: str
    persisted: bool
    queued: bool
    decision: GatewayDecision
    meta: ApiMeta
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        gateway_enabled = self.gateway_enabled

        mode = self.mode

        persisted = self.persisted

        queued = self.queued

        decision = self.decision.to_dict()

        meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "gatewayEnabled": gateway_enabled,
                "mode": mode,
                "persisted": persisted,
                "queued": queued,
                "decision": decision,
                "meta": meta,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_meta import ApiMeta
        from ..models.gateway_decision import GatewayDecision

        d = dict(src_dict)
        gateway_enabled = d.pop("gatewayEnabled")

        mode = d.pop("mode")

        persisted = d.pop("persisted")

        queued = d.pop("queued")

        decision = GatewayDecision.from_dict(d.pop("decision"))

        meta = ApiMeta.from_dict(d.pop("meta"))

        gateway_decision_response = cls(
            gateway_enabled=gateway_enabled,
            mode=mode,
            persisted=persisted,
            queued=queued,
            decision=decision,
            meta=meta,
        )

        gateway_decision_response.additional_properties = d
        return gateway_decision_response

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
