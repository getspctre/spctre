from enum import Enum


class PolicyImportPreviewResponseSourceFormat(str, Enum):
    AGT_YAML = "AGT_YAML"
    CEDAR = "CEDAR"
    OPA_REGO = "OPA_REGO"

    def __str__(self) -> str:
        return str(self.value)
