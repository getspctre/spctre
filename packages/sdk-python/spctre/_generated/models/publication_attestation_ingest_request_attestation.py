from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.publication_attestation_ingest_request_attestation_schema import (
    PublicationAttestationIngestRequestAttestationSchema,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.publication_attestation_ingest_request_attestation_classification import (
        PublicationAttestationIngestRequestAttestationClassification,
    )
    from ..models.publication_attestation_ingest_request_attestation_content import (
        PublicationAttestationIngestRequestAttestationContent,
    )
    from ..models.publication_attestation_ingest_request_attestation_disclosure import (
        PublicationAttestationIngestRequestAttestationDisclosure,
    )
    from ..models.publication_attestation_ingest_request_attestation_editorial import (
        PublicationAttestationIngestRequestAttestationEditorial,
    )
    from ..models.publication_attestation_ingest_request_attestation_generation import (
        PublicationAttestationIngestRequestAttestationGeneration,
    )
    from ..models.publication_attestation_ingest_request_attestation_publisher import (
        PublicationAttestationIngestRequestAttestationPublisher,
    )
    from ..models.publication_attestation_ingest_request_attestation_timestamps import (
        PublicationAttestationIngestRequestAttestationTimestamps,
    )


T = TypeVar("T", bound="PublicationAttestationIngestRequestAttestation")


@_attrs_define
class PublicationAttestationIngestRequestAttestation:
    """
    Attributes:
        schema (PublicationAttestationIngestRequestAttestationSchema):
        attestation_id (UUID):
        content (PublicationAttestationIngestRequestAttestationContent):
        generation (PublicationAttestationIngestRequestAttestationGeneration):
        editorial (PublicationAttestationIngestRequestAttestationEditorial):
        publisher (PublicationAttestationIngestRequestAttestationPublisher):
        disclosure (PublicationAttestationIngestRequestAttestationDisclosure):
        timestamps (PublicationAttestationIngestRequestAttestationTimestamps):
        supersedes (UUID | Unset):
        classification (PublicationAttestationIngestRequestAttestationClassification | Unset):
    """

    schema: PublicationAttestationIngestRequestAttestationSchema
    attestation_id: UUID
    content: PublicationAttestationIngestRequestAttestationContent
    generation: PublicationAttestationIngestRequestAttestationGeneration
    editorial: PublicationAttestationIngestRequestAttestationEditorial
    publisher: PublicationAttestationIngestRequestAttestationPublisher
    disclosure: PublicationAttestationIngestRequestAttestationDisclosure
    timestamps: PublicationAttestationIngestRequestAttestationTimestamps
    supersedes: UUID | Unset = UNSET
    classification: (
        PublicationAttestationIngestRequestAttestationClassification | Unset
    ) = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        schema = self.schema.value

        attestation_id = str(self.attestation_id)

        content = self.content.to_dict()

        generation = self.generation.to_dict()

        editorial = self.editorial.to_dict()

        publisher = self.publisher.to_dict()

        disclosure = self.disclosure.to_dict()

        timestamps = self.timestamps.to_dict()

        supersedes: str | Unset = UNSET
        if not isinstance(self.supersedes, Unset):
            supersedes = str(self.supersedes)

        classification: dict[str, Any] | Unset = UNSET
        if not isinstance(self.classification, Unset):
            classification = self.classification.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "schema": schema,
                "attestationId": attestation_id,
                "content": content,
                "generation": generation,
                "editorial": editorial,
                "publisher": publisher,
                "disclosure": disclosure,
                "timestamps": timestamps,
            }
        )
        if supersedes is not UNSET:
            field_dict["supersedes"] = supersedes
        if classification is not UNSET:
            field_dict["classification"] = classification

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.publication_attestation_ingest_request_attestation_classification import (
            PublicationAttestationIngestRequestAttestationClassification,
        )
        from ..models.publication_attestation_ingest_request_attestation_content import (
            PublicationAttestationIngestRequestAttestationContent,
        )
        from ..models.publication_attestation_ingest_request_attestation_disclosure import (
            PublicationAttestationIngestRequestAttestationDisclosure,
        )
        from ..models.publication_attestation_ingest_request_attestation_editorial import (
            PublicationAttestationIngestRequestAttestationEditorial,
        )
        from ..models.publication_attestation_ingest_request_attestation_generation import (
            PublicationAttestationIngestRequestAttestationGeneration,
        )
        from ..models.publication_attestation_ingest_request_attestation_publisher import (
            PublicationAttestationIngestRequestAttestationPublisher,
        )
        from ..models.publication_attestation_ingest_request_attestation_timestamps import (
            PublicationAttestationIngestRequestAttestationTimestamps,
        )

        d = dict(src_dict)
        schema = PublicationAttestationIngestRequestAttestationSchema(d.pop("schema"))

        attestation_id = UUID(d.pop("attestationId"))

        content = PublicationAttestationIngestRequestAttestationContent.from_dict(
            d.pop("content")
        )

        generation = PublicationAttestationIngestRequestAttestationGeneration.from_dict(
            d.pop("generation")
        )

        editorial = PublicationAttestationIngestRequestAttestationEditorial.from_dict(
            d.pop("editorial")
        )

        publisher = PublicationAttestationIngestRequestAttestationPublisher.from_dict(
            d.pop("publisher")
        )

        disclosure = PublicationAttestationIngestRequestAttestationDisclosure.from_dict(
            d.pop("disclosure")
        )

        timestamps = PublicationAttestationIngestRequestAttestationTimestamps.from_dict(
            d.pop("timestamps")
        )

        _supersedes = d.pop("supersedes", UNSET)
        supersedes: UUID | Unset
        if isinstance(_supersedes, Unset):
            supersedes = UNSET
        else:
            supersedes = UUID(_supersedes)

        _classification = d.pop("classification", UNSET)
        classification: (
            PublicationAttestationIngestRequestAttestationClassification | Unset
        )
        if isinstance(_classification, Unset):
            classification = UNSET
        else:
            classification = (
                PublicationAttestationIngestRequestAttestationClassification.from_dict(
                    _classification
                )
            )

        publication_attestation_ingest_request_attestation = cls(
            schema=schema,
            attestation_id=attestation_id,
            content=content,
            generation=generation,
            editorial=editorial,
            publisher=publisher,
            disclosure=disclosure,
            timestamps=timestamps,
            supersedes=supersedes,
            classification=classification,
        )

        publication_attestation_ingest_request_attestation.additional_properties = d
        return publication_attestation_ingest_request_attestation

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
