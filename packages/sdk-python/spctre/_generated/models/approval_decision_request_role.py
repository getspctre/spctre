from enum import Enum


class ApprovalDecisionRequestRole(str, Enum):
    ADMIN = "Admin"
    LEGAL = "Legal"
    OPS = "Ops"
    PLATFORM = "Platform"
    SECURITY = "Security"

    def __str__(self) -> str:
        return str(self.value)
