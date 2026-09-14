from enum import Enum


class PolicyPublishReadinessResponseStatus(str, Enum):
    BLOCKED = "BLOCKED"
    READY = "READY"

    def __str__(self) -> str:
        return str(self.value)
