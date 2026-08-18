from enum import Enum


class PolicyImportRequestSourceFormat(str, Enum):
    AGT_YAML = "AGT_YAML"
    CEDAR = "CEDAR"
    OPA_REGO = "OPA_REGO"

    def __str__(self) -> str:
        return str(self.value)
