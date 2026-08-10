from enum import Enum


class ForensicEvidenceQueryResponse402Plan(str, Enum):
    CLOUD = "cloud"

    def __str__(self) -> str:
        return str(self.value)
