from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.api_meta import ApiMeta
    from ..models.evidence_ingest_response_evidence import (
        EvidenceIngestResponseEvidence,
    )
    from ..models.evidence_ingest_response_gateway import EvidenceIngestResponseGateway


T = TypeVar("T", bound="EvidenceIngestResponse")


@_attrs_define
class EvidenceIngestResponse:
    """
    Attributes:
        evidence (EvidenceIngestResponseEvidence): The persisted evidence record (canonical shape).
        meta (ApiMeta):
        gateway (EvidenceIngestResponseGateway | Unset): Gateway evaluation result, if the gateway is enabled.
        deduplicated (bool | Unset): True when a record with the same decisionId already exists (200 response).
    """

    evidence: EvidenceIngestResponseEvidence
    meta: ApiMeta
    gateway: EvidenceIngestResponseGateway | Unset = UNSET
    deduplicated: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        evidence = self.evidence.to_dict()

        meta = self.meta.to_dict()

        gateway: dict[str, Any] | Unset = UNSET
        if not isinstance(self.gateway, Unset):
            gateway = self.gateway.to_dict()

        deduplicated = self.deduplicated

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "evidence": evidence,
                "meta": meta,
            }
        )
        if gateway is not UNSET:
            field_dict["gateway"] = gateway
        if deduplicated is not UNSET:
            field_dict["deduplicated"] = deduplicated

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_meta import ApiMeta
        from ..models.evidence_ingest_response_evidence import (
            EvidenceIngestResponseEvidence,
        )
        from ..models.evidence_ingest_response_gateway import (
            EvidenceIngestResponseGateway,
        )

        d = dict(src_dict)
        evidence = EvidenceIngestResponseEvidence.from_dict(d.pop("evidence"))

        meta = ApiMeta.from_dict(d.pop("meta"))

        _gateway = d.pop("gateway", UNSET)
        gateway: EvidenceIngestResponseGateway | Unset
        if isinstance(_gateway, Unset):
            gateway = UNSET
        else:
            gateway = EvidenceIngestResponseGateway.from_dict(_gateway)

        deduplicated = d.pop("deduplicated", UNSET)

        evidence_ingest_response = cls(
            evidence=evidence,
            meta=meta,
            gateway=gateway,
            deduplicated=deduplicated,
        )

        evidence_ingest_response.additional_properties = d
        return evidence_ingest_response

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
