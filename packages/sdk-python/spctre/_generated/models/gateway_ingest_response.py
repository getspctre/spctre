from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.api_meta import ApiMeta


T = TypeVar("T", bound="GatewayIngestResponse")


@_attrs_define
class GatewayIngestResponse:
    """
    Attributes:
        decision_id (str):
        provenance_gap (bool): True when Spctre could not fully link the gateway event to a published policy revision or
            connector mapping.
        deduplicated (bool): True when the provider event was already ingested.
        meta (ApiMeta):
    """

    decision_id: str
    provenance_gap: bool
    deduplicated: bool
    meta: ApiMeta
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        decision_id = self.decision_id

        provenance_gap = self.provenance_gap

        deduplicated = self.deduplicated

        meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "decisionId": decision_id,
                "provenanceGap": provenance_gap,
                "deduplicated": deduplicated,
                "meta": meta,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_meta import ApiMeta

        d = dict(src_dict)
        decision_id = d.pop("decisionId")

        provenance_gap = d.pop("provenanceGap")

        deduplicated = d.pop("deduplicated")

        meta = ApiMeta.from_dict(d.pop("meta"))

        gateway_ingest_response = cls(
            decision_id=decision_id,
            provenance_gap=provenance_gap,
            deduplicated=deduplicated,
            meta=meta,
        )

        gateway_ingest_response.additional_properties = d
        return gateway_ingest_response

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
