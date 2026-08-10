from enum import Enum


class ScimCreateUserResponse402Plan(str, Enum):
    CLOUD = "cloud"

    def __str__(self) -> str:
        return str(self.value)
