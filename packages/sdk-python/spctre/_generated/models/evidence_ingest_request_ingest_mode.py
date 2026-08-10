from enum import Enum


class EvidenceIngestRequestIngestMode(str, Enum):
    GATEWAY = "gateway"
    STANDARD = "standard"

    def __str__(self) -> str:
        return str(self.value)
