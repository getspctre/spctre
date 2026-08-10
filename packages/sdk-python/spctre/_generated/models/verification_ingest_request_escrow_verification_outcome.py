from enum import Enum


class VerificationIngestRequestEscrowVerificationOutcome(str, Enum):
    FAIL = "FAIL"
    PASS = "PASS"
    WARN = "WARN"

    def __str__(self) -> str:
        return str(self.value)
