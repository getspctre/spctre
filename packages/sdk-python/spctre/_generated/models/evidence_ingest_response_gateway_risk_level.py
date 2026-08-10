from enum import Enum


class EvidenceIngestResponseGatewayRiskLevel(str, Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    LOW = "LOW"
    MEDIUM = "MEDIUM"

    def __str__(self) -> str:
        return str(self.value)
