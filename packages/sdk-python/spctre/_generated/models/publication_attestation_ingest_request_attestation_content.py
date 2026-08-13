from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.publication_attestation_ingest_request_attestation_content_modality import (
    PublicationAttestationIngestRequestAttestationContentModality,
)

T = TypeVar("T", bound="PublicationAttestationIngestRequestAttestationContent")


@_attrs_define
class PublicationAttestationIngestRequestAttestationContent:
    """
    Attributes:
        hash_ (str):
        artifact_ref (str):
        version (str):
        identity (str):
        modality (PublicationAttestationIngestRequestAttestationContentModality):
    """

    hash_: str
    artifact_ref: str
    version: str
    identity: str
    modality: PublicationAttestationIngestRequestAttestationContentModality
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        hash_ = self.hash_

        artifact_ref = self.artifact_ref

        version = self.version

        identity = self.identity

        modality = self.modality.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "hash": hash_,
                "artifactRef": artifact_ref,
                "version": version,
                "identity": identity,
                "modality": modality,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        hash_ = d.pop("hash")

        artifact_ref = d.pop("artifactRef")

        version = d.pop("version")

        identity = d.pop("identity")

        modality = PublicationAttestationIngestRequestAttestationContentModality(
            d.pop("modality")
        )

        publication_attestation_ingest_request_attestation_content = cls(
            hash_=hash_,
            artifact_ref=artifact_ref,
            version=version,
            identity=identity,
            modality=modality,
        )

        publication_attestation_ingest_request_attestation_content.additional_properties = d
        return publication_attestation_ingest_request_attestation_content

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
