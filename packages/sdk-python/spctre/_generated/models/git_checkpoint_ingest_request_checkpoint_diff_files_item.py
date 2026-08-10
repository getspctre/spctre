from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.git_checkpoint_ingest_request_checkpoint_diff_files_item_status import (
    GitCheckpointIngestRequestCheckpointDiffFilesItemStatus,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="GitCheckpointIngestRequestCheckpointDiffFilesItem")


@_attrs_define
class GitCheckpointIngestRequestCheckpointDiffFilesItem:
    """
    Attributes:
        path (str):
        status (GitCheckpointIngestRequestCheckpointDiffFilesItemStatus | Unset):
        previous_path (str | Unset):
    """

    path: str
    status: GitCheckpointIngestRequestCheckpointDiffFilesItemStatus | Unset = UNSET
    previous_path: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        path = self.path

        status: str | Unset = UNSET
        if not isinstance(self.status, Unset):
            status = self.status.value

        previous_path = self.previous_path

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "path": path,
            }
        )
        if status is not UNSET:
            field_dict["status"] = status
        if previous_path is not UNSET:
            field_dict["previousPath"] = previous_path

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        path = d.pop("path")

        _status = d.pop("status", UNSET)
        status: GitCheckpointIngestRequestCheckpointDiffFilesItemStatus | Unset
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = GitCheckpointIngestRequestCheckpointDiffFilesItemStatus(_status)

        previous_path = d.pop("previousPath", UNSET)

        git_checkpoint_ingest_request_checkpoint_diff_files_item = cls(
            path=path,
            status=status,
            previous_path=previous_path,
        )

        git_checkpoint_ingest_request_checkpoint_diff_files_item.additional_properties = d
        return git_checkpoint_ingest_request_checkpoint_diff_files_item

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
