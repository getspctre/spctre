from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.gateway_decision_outcome import GatewayDecisionOutcome
from ..models.gateway_decision_risk_level import GatewayDecisionRiskLevel
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.credential_grant import CredentialGrant


T = TypeVar("T", bound="GatewayDecision")


@_attrs_define
class GatewayDecision:
    """
    Attributes:
        outcome (GatewayDecisionOutcome):
        reason (str):
        risk_level (GatewayDecisionRiskLevel):
        should_queue (bool):
        sla_hours (int | Unset):
        credential_grant (CredentialGrant | Unset):
    """

    outcome: GatewayDecisionOutcome
    reason: str
    risk_level: GatewayDecisionRiskLevel
    should_queue: bool
    sla_hours: int | Unset = UNSET
    credential_grant: CredentialGrant | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        outcome = self.outcome.value

        reason = self.reason

        risk_level = self.risk_level.value

        should_queue = self.should_queue

        sla_hours = self.sla_hours

        credential_grant: dict[str, Any] | Unset = UNSET
        if not isinstance(self.credential_grant, Unset):
            credential_grant = self.credential_grant.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "outcome": outcome,
                "reason": reason,
                "riskLevel": risk_level,
                "shouldQueue": should_queue,
            }
        )
        if sla_hours is not UNSET:
            field_dict["slaHours"] = sla_hours
        if credential_grant is not UNSET:
            field_dict["credentialGrant"] = credential_grant

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.credential_grant import CredentialGrant

        d = dict(src_dict)
        outcome = GatewayDecisionOutcome(d.pop("outcome"))

        reason = d.pop("reason")

        risk_level = GatewayDecisionRiskLevel(d.pop("riskLevel"))

        should_queue = d.pop("shouldQueue")

        sla_hours = d.pop("slaHours", UNSET)

        _credential_grant = d.pop("credentialGrant", UNSET)
        credential_grant: CredentialGrant | Unset
        if isinstance(_credential_grant, Unset):
            credential_grant = UNSET
        else:
            credential_grant = CredentialGrant.from_dict(_credential_grant)

        gateway_decision = cls(
            outcome=outcome,
            reason=reason,
            risk_level=risk_level,
            should_queue=should_queue,
            sla_hours=sla_hours,
            credential_grant=credential_grant,
        )

        gateway_decision.additional_properties = d
        return gateway_decision

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
