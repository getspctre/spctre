from enum import Enum


class PolicyImportRequestScope(str, Enum):
    CONNECTOR = "CONNECTOR"
    ENVIRONMENT = "ENVIRONMENT"
    ORGANIZATION = "ORGANIZATION"
    WORKSPACE = "WORKSPACE"

    def __str__(self) -> str:
        return str(self.value)
