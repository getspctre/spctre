from enum import Enum


class GatewayDecisionRiskLevel(str, Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    LOW = "LOW"
    MEDIUM = "MEDIUM"

    def __str__(self) -> str:
        return str(self.value)
