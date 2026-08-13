from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.api_meta import ApiMeta


T = TypeVar("T", bound="PublicationAttestationIngestResponse")


@_attrs_define
class PublicationAttestationIngestResponse:
    """
    Attributes:
        attestation_id (UUID):
        deduplicated (bool):
        receipt_verified (bool | None):
        meta (ApiMeta):
    """

    attestation_id: UUID
    deduplicated: bool
    receipt_verified: bool | None
    meta: ApiMeta
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        attestation_id = str(self.attestation_id)

        deduplicated = self.deduplicated

        receipt_verified: bool | None
        receipt_verified = self.receipt_verified

        meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "attestationId": attestation_id,
                "deduplicated": deduplicated,
                "receiptVerified": receipt_verified,
                "meta": meta,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_meta import ApiMeta

        d = dict(src_dict)
        attestation_id = UUID(d.pop("attestationId"))

        deduplicated = d.pop("deduplicated")

        def _parse_receipt_verified(data: object) -> bool | None:
            if data is None:
                return data
            return cast(bool | None, data)

        receipt_verified = _parse_receipt_verified(d.pop("receiptVerified"))

        meta = ApiMeta.from_dict(d.pop("meta"))

        publication_attestation_ingest_response = cls(
            attestation_id=attestation_id,
            deduplicated=deduplicated,
            receipt_verified=receipt_verified,
            meta=meta,
        )

        publication_attestation_ingest_response.additional_properties = d
        return publication_attestation_ingest_response

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
