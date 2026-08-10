from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.git_checkpoint_ingest_request_checkpoint_diff_format import (
    GitCheckpointIngestRequestCheckpointDiffFormat,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.git_checkpoint_ingest_request_checkpoint_diff_files_item import (
        GitCheckpointIngestRequestCheckpointDiffFilesItem,
    )


T = TypeVar("T", bound="GitCheckpointIngestRequestCheckpointDiff")


@_attrs_define
class GitCheckpointIngestRequestCheckpointDiff:
    """
    Attributes:
        format_ (GitCheckpointIngestRequestCheckpointDiffFormat):
        content (str | Unset):
        sha256 (str | Unset):
        files (list[GitCheckpointIngestRequestCheckpointDiffFilesItem] | Unset):
    """

    format_: GitCheckpointIngestRequestCheckpointDiffFormat
    content: str | Unset = UNSET
    sha256: str | Unset = UNSET
    files: list[GitCheckpointIngestRequestCheckpointDiffFilesItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        format_ = self.format_.value

        content = self.content

        sha256 = self.sha256

        files: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.files, Unset):
            files = []
            for files_item_data in self.files:
                files_item = files_item_data.to_dict()
                files.append(files_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "format": format_,
            }
        )
        if content is not UNSET:
            field_dict["content"] = content
        if sha256 is not UNSET:
            field_dict["sha256"] = sha256
        if files is not UNSET:
            field_dict["files"] = files

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.git_checkpoint_ingest_request_checkpoint_diff_files_item import (
            GitCheckpointIngestRequestCheckpointDiffFilesItem,
        )

        d = dict(src_dict)
        format_ = GitCheckpointIngestRequestCheckpointDiffFormat(d.pop("format"))

        content = d.pop("content", UNSET)

        sha256 = d.pop("sha256", UNSET)

        _files = d.pop("files", UNSET)
        files: list[GitCheckpointIngestRequestCheckpointDiffFilesItem] | Unset = UNSET
        if _files is not UNSET:
            files = []
            for files_item_data in _files:
                files_item = (
                    GitCheckpointIngestRequestCheckpointDiffFilesItem.from_dict(
                        files_item_data
                    )
                )

                files.append(files_item)

        git_checkpoint_ingest_request_checkpoint_diff = cls(
            format_=format_,
            content=content,
            sha256=sha256,
            files=files,
        )

        git_checkpoint_ingest_request_checkpoint_diff.additional_properties = d
        return git_checkpoint_ingest_request_checkpoint_diff

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
