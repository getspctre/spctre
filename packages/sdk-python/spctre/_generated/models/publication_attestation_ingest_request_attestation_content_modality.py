from enum import Enum


class PublicationAttestationIngestRequestAttestationContentModality(str, Enum):
    AUDIO = "audio"
    IMAGE = "image"
    OTHER = "other"
    TEXT = "text"
    VIDEO = "video"

    def __str__(self) -> str:
        return str(self.value)
