from enum import Enum


class GitCheckpointIngestRequestCheckpointDiffFormat(str, Enum):
    NAME_STATUS = "name-status"
    NONE = "none"
    UNIFIED = "unified"

    def __str__(self) -> str:
        return str(self.value)
