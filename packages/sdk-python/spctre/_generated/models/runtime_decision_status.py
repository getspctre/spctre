from enum import Enum


class RuntimeDecisionStatus(str, Enum):
    ALLOW = "ALLOW"
    DENY = "DENY"
    ESCALATE = "ESCALATE"
    WARN = "WARN"

    def __str__(self) -> str:
        return str(self.value)
