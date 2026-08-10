from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.git_checkpoint_ingest_request_checkpoint_diff import (
        GitCheckpointIngestRequestCheckpointDiff,
    )
    from ..models.git_checkpoint_ingest_request_checkpoint_repository import (
        GitCheckpointIngestRequestCheckpointRepository,
    )


T = TypeVar("T", bound="GitCheckpointIngestRequestCheckpoint")


@_attrs_define
class GitCheckpointIngestRequestCheckpoint:
    """
    Attributes:
        id (str):
        created_at (datetime.datetime):
        repository (GitCheckpointIngestRequestCheckpointRepository):
        head_commit (str):
        diff (GitCheckpointIngestRequestCheckpointDiff):
        ref (str | Unset):
        base_commit (str | Unset):
    """

    id: str
    created_at: datetime.datetime
    repository: GitCheckpointIngestRequestCheckpointRepository
    head_commit: str
    diff: GitCheckpointIngestRequestCheckpointDiff
    ref: str | Unset = UNSET
    base_commit: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        created_at = self.created_at.isoformat()

        repository = self.repository.to_dict()

        head_commit = self.head_commit

        diff = self.diff.to_dict()

        ref = self.ref

        base_commit = self.base_commit

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "createdAt": created_at,
                "repository": repository,
                "headCommit": head_commit,
                "diff": diff,
            }
        )
        if ref is not UNSET:
            field_dict["ref"] = ref
        if base_commit is not UNSET:
            field_dict["baseCommit"] = base_commit

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.git_checkpoint_ingest_request_checkpoint_diff import (
            GitCheckpointIngestRequestCheckpointDiff,
        )
        from ..models.git_checkpoint_ingest_request_checkpoint_repository import (
            GitCheckpointIngestRequestCheckpointRepository,
        )

        d = dict(src_dict)
        id = d.pop("id")

        created_at = datetime.datetime.fromisoformat(d.pop("createdAt"))

        repository = GitCheckpointIngestRequestCheckpointRepository.from_dict(
            d.pop("repository")
        )

        head_commit = d.pop("headCommit")

        diff = GitCheckpointIngestRequestCheckpointDiff.from_dict(d.pop("diff"))

        ref = d.pop("ref", UNSET)

        base_commit = d.pop("baseCommit", UNSET)

        git_checkpoint_ingest_request_checkpoint = cls(
            id=id,
            created_at=created_at,
            repository=repository,
            head_commit=head_commit,
            diff=diff,
            ref=ref,
            base_commit=base_commit,
        )

        git_checkpoint_ingest_request_checkpoint.additional_properties = d
        return git_checkpoint_ingest_request_checkpoint

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
