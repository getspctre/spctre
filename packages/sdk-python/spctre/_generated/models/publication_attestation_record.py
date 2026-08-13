from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.publication_attestation_record_payload import (
        PublicationAttestationRecordPayload,
    )
    from ..models.publication_attestation_record_policy_context import (
        PublicationAttestationRecordPolicyContext,
    )


T = TypeVar("T", bound="PublicationAttestationRecord")


@_attrs_define
class PublicationAttestationRecord:
    """
    Attributes:
        id (UUID):
        content_hash (str):
        content_identity (str):
        content_version (str):
        payload_hash (str):
        policy_context (PublicationAttestationRecordPolicyContext):
        receipt_verified (bool):
        attested_at (datetime.datetime):
        created_at (datetime.datetime):
        payload (PublicationAttestationRecordPayload):
        supersedes_id (None | Unset | UUID):
    """

    id: UUID
    content_hash: str
    content_identity: str
    content_version: str
    payload_hash: str
    policy_context: PublicationAttestationRecordPolicyContext
    receipt_verified: bool
    attested_at: datetime.datetime
    created_at: datetime.datetime
    payload: PublicationAttestationRecordPayload
    supersedes_id: None | Unset | UUID = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        content_hash = self.content_hash

        content_identity = self.content_identity

        content_version = self.content_version

        payload_hash = self.payload_hash

        policy_context = self.policy_context.to_dict()

        receipt_verified = self.receipt_verified

        attested_at = self.attested_at.isoformat()

        created_at = self.created_at.isoformat()

        payload = self.payload.to_dict()

        supersedes_id: None | str | Unset
        if isinstance(self.supersedes_id, Unset):
            supersedes_id = UNSET
        elif isinstance(self.supersedes_id, UUID):
            supersedes_id = str(self.supersedes_id)
        else:
            supersedes_id = self.supersedes_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "contentHash": content_hash,
                "contentIdentity": content_identity,
                "contentVersion": content_version,
                "payloadHash": payload_hash,
                "policyContext": policy_context,
                "receiptVerified": receipt_verified,
                "attestedAt": attested_at,
                "createdAt": created_at,
                "payload": payload,
            }
        )
        if supersedes_id is not UNSET:
            field_dict["supersedesId"] = supersedes_id

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.publication_attestation_record_payload import (
            PublicationAttestationRecordPayload,
        )
        from ..models.publication_attestation_record_policy_context import (
            PublicationAttestationRecordPolicyContext,
        )

        d = dict(src_dict)
        id = UUID(d.pop("id"))

        content_hash = d.pop("contentHash")

        content_identity = d.pop("contentIdentity")

        content_version = d.pop("contentVersion")

        payload_hash = d.pop("payloadHash")

        policy_context = PublicationAttestationRecordPolicyContext.from_dict(
            d.pop("policyContext")
        )

        receipt_verified = d.pop("receiptVerified")

        attested_at = datetime.datetime.fromisoformat(d.pop("attestedAt"))

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        payload = PublicationAttestationRecordPayload.from_dict(d.pop("payload"))

        def _parse_supersedes_id(data: object) -> None | Unset | UUID:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                supersedes_id_type_0 = UUID(data)

                return supersedes_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | UUID, data)

        supersedes_id = _parse_supersedes_id(d.pop("supersedesId", UNSET))

        publication_attestation_record = cls(
            id=id,
            content_hash=content_hash,
            content_identity=content_identity,
            content_version=content_version,
            payload_hash=payload_hash,
            policy_context=policy_context,
            receipt_verified=receipt_verified,
            attested_at=attested_at,
            created_at=created_at,
            payload=payload,
            supersedes_id=supersedes_id,
        )

        publication_attestation_record.additional_properties = d
        return publication_attestation_record

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
