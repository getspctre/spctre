from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.policy_publish_readiness_response_status import (
    PolicyPublishReadinessResponseStatus,
)

if TYPE_CHECKING:
    from ..models.api_meta import ApiMeta
    from ..models.policy_publish_readiness_response_approvals_item import (
        PolicyPublishReadinessResponseApprovalsItem,
    )


T = TypeVar("T", bound="PolicyPublishReadinessResponse")


@_attrs_define
class PolicyPublishReadinessResponse:
    """
    Attributes:
        status (PolicyPublishReadinessResponseStatus): Whether publishing this revision would be accepted right now.
        blocking_reasons (list[str]): Why it would be refused. Empty when READY.
        required_roles (list[str]): Reviewer roles the workflow requires for this revision.
        approvals (list[PolicyPublishReadinessResponseApprovalsItem]): Decisions recorded so far, by reviewer and role.
        verification_required (bool): Whether the workflow requires a verification run before publishing.
        meta (ApiMeta):
    """

    status: PolicyPublishReadinessResponseStatus
    blocking_reasons: list[str]
    required_roles: list[str]
    approvals: list[PolicyPublishReadinessResponseApprovalsItem]
    verification_required: bool
    meta: ApiMeta
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        status = self.status.value

        blocking_reasons = self.blocking_reasons

        required_roles = self.required_roles

        approvals = []
        for approvals_item_data in self.approvals:
            approvals_item = approvals_item_data.to_dict()
            approvals.append(approvals_item)

        verification_required = self.verification_required

        meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "status": status,
                "blockingReasons": blocking_reasons,
                "requiredRoles": required_roles,
                "approvals": approvals,
                "verificationRequired": verification_required,
                "meta": meta,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_meta import ApiMeta
        from ..models.policy_publish_readiness_response_approvals_item import (
            PolicyPublishReadinessResponseApprovalsItem,
        )

        d = dict(src_dict)
        status = PolicyPublishReadinessResponseStatus(d.pop("status"))

        blocking_reasons = cast(list[str], d.pop("blockingReasons"))

        required_roles = cast(list[str], d.pop("requiredRoles"))

        approvals = []
        _approvals = d.pop("approvals")
        for approvals_item_data in _approvals:
            approvals_item = PolicyPublishReadinessResponseApprovalsItem.from_dict(
                approvals_item_data
            )

            approvals.append(approvals_item)

        verification_required = d.pop("verificationRequired")

        meta = ApiMeta.from_dict(d.pop("meta"))

        policy_publish_readiness_response = cls(
            status=status,
            blocking_reasons=blocking_reasons,
            required_roles=required_roles,
            approvals=approvals,
            verification_required=verification_required,
            meta=meta,
        )

        policy_publish_readiness_response.additional_properties = d
        return policy_publish_readiness_response

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
