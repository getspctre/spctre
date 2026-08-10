from enum import Enum


class GitCheckpointIngestRequestCheckpointDiffFilesItemStatus(str, Enum):
    ADDED = "added"
    COPIED = "copied"
    DELETED = "deleted"
    MODIFIED = "modified"
    RENAMED = "renamed"
    UNMERGED = "unmerged"

    def __str__(self) -> str:
        return str(self.value)
