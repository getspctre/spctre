from enum import Enum


class ScimListUsersResponse402Plan(str, Enum):
    CLOUD = "cloud"

    def __str__(self) -> str:
        return str(self.value)
