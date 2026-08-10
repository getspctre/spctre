from enum import Enum


class EscalationStatusResponseResolutionOutcome(str, Enum):
    ABORT = "ABORT"
    ESCALATE = "ESCALATE"
    PROCEED = "PROCEED"

    def __str__(self) -> str:
        return str(self.value)
