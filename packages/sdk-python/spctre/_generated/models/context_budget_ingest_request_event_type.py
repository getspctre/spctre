from enum import Enum


class ContextBudgetIngestRequestEventType(str, Enum):
    BUDGET_BREACH = "BUDGET_BREACH"
    CONTEXT_SOURCE_MIX = "CONTEXT_SOURCE_MIX"
    SUMMARIZATION_EVENT = "SUMMARIZATION_EVENT"
    TOKEN_GROWTH = "TOKEN_GROWTH"

    def __str__(self) -> str:
        return str(self.value)
