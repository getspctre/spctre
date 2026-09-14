from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.approval_decision_request_approval_status import (
    ApprovalDecisionRequestApprovalStatus,
)
from ..models.approval_decision_request_role import ApprovalDecisionRequestRole
from ..types import UNSET, Unset

T = TypeVar("T", bound="ApprovalDecisionRequest")


@_attrs_define
class ApprovalDecisionRequest:
    """
    Attributes:
        revision_id (str): The policy revision under review.
        role (ApprovalDecisionRequestRole): The reviewer role this decision is cast in. The token's principal must hold
            it.
        approval_status (ApprovalDecisionRequestApprovalStatus): The decision. Re-submitting replaces this reviewer's
            previous decision.
        note (str | Unset): Optional reviewer note recorded with the decision.
    """

    revision_id: str
    role: ApprovalDecisionRequestRole
    approval_status: ApprovalDecisionRequestApprovalStatus
    note: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        revision_id = self.revision_id

        role = self.role.value

        approval_status = self.approval_status.value

        note = self.note

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "revisionId": revision_id,
                "role": role,
                "approvalStatus": approval_status,
            }
        )
        if note is not UNSET:
            field_dict["note"] = note

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        revision_id = d.pop("revisionId")

        role = ApprovalDecisionRequestRole(d.pop("role"))

        approval_status = ApprovalDecisionRequestApprovalStatus(d.pop("approvalStatus"))

        note = d.pop("note", UNSET)

        approval_decision_request = cls(
            revision_id=revision_id,
            role=role,
            approval_status=approval_status,
            note=note,
        )

        approval_decision_request.additional_properties = d
        return approval_decision_request

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
