from enum import Enum


class GatewayDecisionOutcome(str, Enum):
    ABORT = "ABORT"
    ESCALATE = "ESCALATE"
    PROCEED = "PROCEED"

    def __str__(self) -> str:
        return str(self.value)
