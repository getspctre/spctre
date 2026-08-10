from enum import Enum


class TrustScoreIngestRequestSource(str, Enum):
    EVIDENCE_INGEST = "EVIDENCE_INGEST"
    IDENTITY_EVENT = "IDENTITY_EVENT"
    MANUAL = "MANUAL"
    POLICY_EVALUATION = "POLICY_EVALUATION"
    SYSTEM = "SYSTEM"

    def __str__(self) -> str:
        return str(self.value)
