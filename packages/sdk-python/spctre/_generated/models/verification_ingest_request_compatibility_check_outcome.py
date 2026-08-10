from enum import Enum


class VerificationIngestRequestCompatibilityCheckOutcome(str, Enum):
    FAIL = "FAIL"
    PASS = "PASS"
    WARN = "WARN"

    def __str__(self) -> str:
        return str(self.value)
