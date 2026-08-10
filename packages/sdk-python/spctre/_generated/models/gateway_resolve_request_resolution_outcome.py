from enum import Enum


class GatewayResolveRequestResolutionOutcome(str, Enum):
    ABORT = "ABORT"
    ESCALATE = "ESCALATE"
    PROCEED = "PROCEED"

    def __str__(self) -> str:
        return str(self.value)
