from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.evidence_ingest_response_gateway_outcome import (
    EvidenceIngestResponseGatewayOutcome,
)
from ..models.evidence_ingest_response_gateway_risk_level import (
    EvidenceIngestResponseGatewayRiskLevel,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="EvidenceIngestResponseGateway")


@_attrs_define
class EvidenceIngestResponseGateway:
    """Gateway evaluation result, if the gateway is enabled.

    Attributes:
        outcome (EvidenceIngestResponseGatewayOutcome | Unset):
        reason (str | Unset):
        risk_level (EvidenceIngestResponseGatewayRiskLevel | Unset):
        should_queue (bool | Unset):
    """

    outcome: EvidenceIngestResponseGatewayOutcome | Unset = UNSET
    reason: str | Unset = UNSET
    risk_level: EvidenceIngestResponseGatewayRiskLevel | Unset = UNSET
    should_queue: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        outcome: str | Unset = UNSET
        if not isinstance(self.outcome, Unset):
            outcome = self.outcome.value

        reason = self.reason

        risk_level: str | Unset = UNSET
        if not isinstance(self.risk_level, Unset):
            risk_level = self.risk_level.value

        should_queue = self.should_queue

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if outcome is not UNSET:
            field_dict["outcome"] = outcome
        if reason is not UNSET:
            field_dict["reason"] = reason
        if risk_level is not UNSET:
            field_dict["riskLevel"] = risk_level
        if should_queue is not UNSET:
            field_dict["shouldQueue"] = should_queue

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        _outcome = d.pop("outcome", UNSET)
        outcome: EvidenceIngestResponseGatewayOutcome | Unset
        if isinstance(_outcome, Unset):
            outcome = UNSET
        else:
            outcome = EvidenceIngestResponseGatewayOutcome(_outcome)

        reason = d.pop("reason", UNSET)

        _risk_level = d.pop("riskLevel", UNSET)
        risk_level: EvidenceIngestResponseGatewayRiskLevel | Unset
        if isinstance(_risk_level, Unset):
            risk_level = UNSET
        else:
            risk_level = EvidenceIngestResponseGatewayRiskLevel(_risk_level)

        should_queue = d.pop("shouldQueue", UNSET)

        evidence_ingest_response_gateway = cls(
            outcome=outcome,
            reason=reason,
            risk_level=risk_level,
            should_queue=should_queue,
        )

        evidence_ingest_response_gateway.additional_properties = d
        return evidence_ingest_response_gateway

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
