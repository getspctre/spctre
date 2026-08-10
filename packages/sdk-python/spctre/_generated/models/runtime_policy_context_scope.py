from enum import Enum


class RuntimePolicyContextScope(str, Enum):
    COMPANY = "COMPANY"
    CONNECTOR = "CONNECTOR"
    ENVIRONMENT = "ENVIRONMENT"
    ORGANIZATION = "ORGANIZATION"
    WORKSPACE = "WORKSPACE"

    def __str__(self) -> str:
        return str(self.value)
