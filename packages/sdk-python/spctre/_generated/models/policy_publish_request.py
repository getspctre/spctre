from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PolicyPublishRequest")


@_attrs_define
class PolicyPublishRequest:
    """
    Attributes:
        branch_id (str): The branch to publish from.
        revision_id (str): The reviewed revision to publish.
    """

    branch_id: str
    revision_id: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        branch_id = self.branch_id

        revision_id = self.revision_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "branchId": branch_id,
                "revisionId": revision_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        branch_id = d.pop("branchId")

        revision_id = d.pop("revisionId")

        policy_publish_request = cls(
            branch_id=branch_id,
            revision_id=revision_id,
        )

        policy_publish_request.additional_properties = d
        return policy_publish_request

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
