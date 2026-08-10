from enum import Enum


class EvidenceIngestRequestPluginSource(str, Enum):
    CORPORATE_MARKETPLACE = "corporate_marketplace"
    CORPORATE_PRIVATE = "corporate_private"
    PUBLIC_MARKETPLACE = "public_marketplace"
    USER_BUILT = "user_built"

    def __str__(self) -> str:
        return str(self.value)
