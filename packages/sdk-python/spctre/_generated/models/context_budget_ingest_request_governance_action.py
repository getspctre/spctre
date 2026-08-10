from enum import Enum


class ContextBudgetIngestRequestGovernanceAction(str, Enum):
    ALLOW = "ALLOW"
    ESCALATE = "ESCALATE"
    REVIEW = "REVIEW"
    WARN = "WARN"

    def __str__(self) -> str:
        return str(self.value)
