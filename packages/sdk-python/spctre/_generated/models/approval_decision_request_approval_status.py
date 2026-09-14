from enum import Enum


class ApprovalDecisionRequestApprovalStatus(str, Enum):
    APPROVED = "APPROVED"
    CHANGES_REQUESTED = "CHANGES_REQUESTED"
    PENDING = "PENDING"

    def __str__(self) -> str:
        return str(self.value)
