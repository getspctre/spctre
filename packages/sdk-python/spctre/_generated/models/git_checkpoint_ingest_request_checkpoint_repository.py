from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GitCheckpointIngestRequestCheckpointRepository")


@_attrs_define
class GitCheckpointIngestRequestCheckpointRepository:
    """
    Attributes:
        id (str):
        remote_url (str | Unset):
    """

    id: str
    remote_url: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        remote_url = self.remote_url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
            }
        )
        if remote_url is not UNSET:
            field_dict["remoteUrl"] = remote_url

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        id = d.pop("id")

        remote_url = d.pop("remoteUrl", UNSET)

        git_checkpoint_ingest_request_checkpoint_repository = cls(
            id=id,
            remote_url=remote_url,
        )

        git_checkpoint_ingest_request_checkpoint_repository.additional_properties = d
        return git_checkpoint_ingest_request_checkpoint_repository

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
