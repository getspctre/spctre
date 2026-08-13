from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.publication_attestation_ingest_request_attestation import (
        PublicationAttestationIngestRequestAttestation,
    )
    from ..models.publication_attestation_ingest_request_receipt import (
        PublicationAttestationIngestRequestReceipt,
    )


T = TypeVar("T", bound="PublicationAttestationIngestRequest")


@_attrs_define
class PublicationAttestationIngestRequest:
    """Framework-agnostic publication facts. Clients submit normalized facts bound to a previously retained byte-exact
    artifact; the server never fetches a URL, renders a page, or adjudicates compliance.

        Attributes:
            idempotency_key (str):
            attestation (PublicationAttestationIngestRequestAttestation):
            receipt (PublicationAttestationIngestRequestReceipt | Unset):
    """

    idempotency_key: str
    attestation: PublicationAttestationIngestRequestAttestation
    receipt: PublicationAttestationIngestRequestReceipt | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        idempotency_key = self.idempotency_key

        attestation = self.attestation.to_dict()

        receipt: dict[str, Any] | Unset = UNSET
        if not isinstance(self.receipt, Unset):
            receipt = self.receipt.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "idempotencyKey": idempotency_key,
                "attestation": attestation,
            }
        )
        if receipt is not UNSET:
            field_dict["receipt"] = receipt

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.publication_attestation_ingest_request_attestation import (
            PublicationAttestationIngestRequestAttestation,
        )
        from ..models.publication_attestation_ingest_request_receipt import (
            PublicationAttestationIngestRequestReceipt,
        )

        d = dict(src_dict)
        idempotency_key = d.pop("idempotencyKey")

        attestation = PublicationAttestationIngestRequestAttestation.from_dict(
            d.pop("attestation")
        )

        _receipt = d.pop("receipt", UNSET)
        receipt: PublicationAttestationIngestRequestReceipt | Unset
        if isinstance(_receipt, Unset):
            receipt = UNSET
        else:
            receipt = PublicationAttestationIngestRequestReceipt.from_dict(_receipt)

        publication_attestation_ingest_request = cls(
            idempotency_key=idempotency_key,
            attestation=attestation,
            receipt=receipt,
        )

        publication_attestation_ingest_request.additional_properties = d
        return publication_attestation_ingest_request

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
