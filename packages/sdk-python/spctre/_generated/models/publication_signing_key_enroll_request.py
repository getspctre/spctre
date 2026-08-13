from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.publication_signing_key_enroll_request_proof import (
        PublicationSigningKeyEnrollRequestProof,
    )


T = TypeVar("T", bound="PublicationSigningKeyEnrollRequest")


@_attrs_define
class PublicationSigningKeyEnrollRequest:
    """
    Attributes:
        entity_ref (str):
        key_id (str):
        public_key (str):
        challenge_id (UUID):
        proof (PublicationSigningKeyEnrollRequestProof):
        replaces_key_id (UUID | Unset):
    """

    entity_ref: str
    key_id: str
    public_key: str
    challenge_id: UUID
    proof: PublicationSigningKeyEnrollRequestProof
    replaces_key_id: UUID | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        entity_ref = self.entity_ref

        key_id = self.key_id

        public_key = self.public_key

        challenge_id = str(self.challenge_id)

        proof = self.proof.to_dict()

        replaces_key_id: str | Unset = UNSET
        if not isinstance(self.replaces_key_id, Unset):
            replaces_key_id = str(self.replaces_key_id)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "entityRef": entity_ref,
                "keyId": key_id,
                "publicKey": public_key,
                "challengeId": challenge_id,
                "proof": proof,
            }
        )
        if replaces_key_id is not UNSET:
            field_dict["replacesKeyId"] = replaces_key_id

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.publication_signing_key_enroll_request_proof import (
            PublicationSigningKeyEnrollRequestProof,
        )

        d = dict(src_dict)
        entity_ref = d.pop("entityRef")

        key_id = d.pop("keyId")

        public_key = d.pop("publicKey")

        challenge_id = UUID(d.pop("challengeId"))

        proof = PublicationSigningKeyEnrollRequestProof.from_dict(d.pop("proof"))

        _replaces_key_id = d.pop("replacesKeyId", UNSET)
        replaces_key_id: UUID | Unset
        if isinstance(_replaces_key_id, Unset):
            replaces_key_id = UNSET
        else:
            replaces_key_id = UUID(_replaces_key_id)

        publication_signing_key_enroll_request = cls(
            entity_ref=entity_ref,
            key_id=key_id,
            public_key=public_key,
            challenge_id=challenge_id,
            proof=proof,
            replaces_key_id=replaces_key_id,
        )

        publication_signing_key_enroll_request.additional_properties = d
        return publication_signing_key_enroll_request

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
