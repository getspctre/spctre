from enum import Enum


class VerificationIngestResponseOutcome(str, Enum):
    FAIL = "FAIL"
    PASS = "PASS"
    WARN = "WARN"

    def __str__(self) -> str:
        return str(self.value)
