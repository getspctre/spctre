from enum import Enum


class EvidenceLayer(str, Enum):
    AGENT = "agent"
    SANDBOX = "sandbox"

    def __str__(self) -> str:
        return str(self.value)
