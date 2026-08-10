from enum import Enum


class VerificationIngestRequestVerificationType(str, Enum):
    AGT_LINT_POLICY = "AGT_LINT_POLICY"
    AGT_REDTEAM = "AGT_REDTEAM"
    AGT_REPLAY = "AGT_REPLAY"
    AGT_VERIFY = "AGT_VERIFY"
    AGT_VERIFY_EVIDENCE = "AGT_VERIFY_EVIDENCE"
    CUSTOM = "CUSTOM"

    def __str__(self) -> str:
        return str(self.value)
