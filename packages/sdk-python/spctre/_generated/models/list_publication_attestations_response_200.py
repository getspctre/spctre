from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.api_meta import ApiMeta
    from ..models.publication_attestation_record import PublicationAttestationRecord


T = TypeVar("T", bound="ListPublicationAttestationsResponse200")


@_attrs_define
class ListPublicationAttestationsResponse200:
    """
    Attributes:
        attestations (list[PublicationAttestationRecord]):
        meta (ApiMeta):
    """

    attestations: list[PublicationAttestationRecord]
    meta: ApiMeta
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        attestations = []
        for attestations_item_data in self.attestations:
            attestations_item = attestations_item_data.to_dict()
            attestations.append(attestations_item)

        meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "attestations": attestations,
                "meta": meta,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_meta import ApiMeta
        from ..models.publication_attestation_record import PublicationAttestationRecord

        d = dict(src_dict)
        attestations = []
        _attestations = d.pop("attestations")
        for attestations_item_data in _attestations:
            attestations_item = PublicationAttestationRecord.from_dict(
                attestations_item_data
            )

            attestations.append(attestations_item)

        meta = ApiMeta.from_dict(d.pop("meta"))

        list_publication_attestations_response_200 = cls(
            attestations=attestations,
            meta=meta,
        )

        list_publication_attestations_response_200.additional_properties = d
        return list_publication_attestations_response_200

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
