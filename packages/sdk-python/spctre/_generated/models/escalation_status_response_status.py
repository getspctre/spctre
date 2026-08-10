from enum import Enum


class EscalationStatusResponseStatus(str, Enum):
    EXPIRED = "EXPIRED"
    IN_REVIEW = "IN_REVIEW"
    PENDING = "PENDING"
    RESOLVED = "RESOLVED"

    def __str__(self) -> str:
        return str(self.value)
