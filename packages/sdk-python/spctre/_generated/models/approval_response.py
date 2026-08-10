from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.api_meta import ApiMeta
    from ..models.approval_response_approval import ApprovalResponseApproval


T = TypeVar("T", bound="ApprovalResponse")


@_attrs_define
class ApprovalResponse:
    """
    Attributes:
        approval (ApprovalResponseApproval): The approval record for the requested revision.
        meta (ApiMeta):
    """

    approval: ApprovalResponseApproval
    meta: ApiMeta
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        approval = self.approval.to_dict()

        meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "approval": approval,
                "meta": meta,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_meta import ApiMeta
        from ..models.approval_response_approval import ApprovalResponseApproval

        d = dict(src_dict)
        approval = ApprovalResponseApproval.from_dict(d.pop("approval"))

        meta = ApiMeta.from_dict(d.pop("meta"))

        approval_response = cls(
            approval=approval,
            meta=meta,
        )

        approval_response.additional_properties = d
        return approval_response

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
