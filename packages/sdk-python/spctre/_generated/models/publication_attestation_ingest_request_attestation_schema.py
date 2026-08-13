from enum import Enum


class PublicationAttestationIngestRequestAttestationSchema(str, Enum):
    SPCTRE_PUBLICATION_ATTESTATION_V1 = "spctre.publication-attestation.v1"

    def __str__(self) -> str:
        return str(self.value)
