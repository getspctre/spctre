from enum import Enum


class BundleExportManifestCompatibilityLevel(str, Enum):
    LOSSLESS_PRESERVED = "LOSSLESS_PRESERVED"
    NATIVE = "NATIVE"
    PARTIAL_SEMANTIC_MAP = "PARTIAL_SEMANTIC_MAP"

    def __str__(self) -> str:
        return str(self.value)
