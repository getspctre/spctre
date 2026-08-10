from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.scim_create_user_response_402_plan import ScimCreateUserResponse402Plan
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.api_error_issues_item import ApiErrorIssuesItem
    from ..models.api_meta import ApiMeta


T = TypeVar("T", bound="ScimCreateUserResponse402")


@_attrs_define
class ScimCreateUserResponse402:
    """
    Attributes:
        error (str): Human-readable error message.
        meta (ApiMeta):
        issues (list[ApiErrorIssuesItem] | Unset): Field-level validation issues (present on 400 responses).
        plan (ScimCreateUserResponse402Plan | Unset): Required plan tier.
    """

    error: str
    meta: ApiMeta
    issues: list[ApiErrorIssuesItem] | Unset = UNSET
    plan: ScimCreateUserResponse402Plan | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        error = self.error

        meta = self.meta.to_dict()

        issues: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.issues, Unset):
            issues = []
            for issues_item_data in self.issues:
                issues_item = issues_item_data.to_dict()
                issues.append(issues_item)

        plan: str | Unset = UNSET
        if not isinstance(self.plan, Unset):
            plan = self.plan.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "error": error,
                "meta": meta,
            }
        )
        if issues is not UNSET:
            field_dict["issues"] = issues
        if plan is not UNSET:
            field_dict["plan"] = plan

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_error_issues_item import ApiErrorIssuesItem
        from ..models.api_meta import ApiMeta

        d = dict(src_dict)
        error = d.pop("error")

        meta = ApiMeta.from_dict(d.pop("meta"))

        _issues = d.pop("issues", UNSET)
        issues: list[ApiErrorIssuesItem] | Unset = UNSET
        if _issues is not UNSET:
            issues = []
            for issues_item_data in _issues:
                issues_item = ApiErrorIssuesItem.from_dict(issues_item_data)

                issues.append(issues_item)

        _plan = d.pop("plan", UNSET)
        plan: ScimCreateUserResponse402Plan | Unset
        if isinstance(_plan, Unset):
            plan = UNSET
        else:
            plan = ScimCreateUserResponse402Plan(_plan)

        scim_create_user_response_402 = cls(
            error=error,
            meta=meta,
            issues=issues,
            plan=plan,
        )

        scim_create_user_response_402.additional_properties = d
        return scim_create_user_response_402

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
