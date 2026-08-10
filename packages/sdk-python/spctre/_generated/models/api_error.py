from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.api_error_issues_item import ApiErrorIssuesItem
    from ..models.api_meta import ApiMeta


T = TypeVar("T", bound="ApiError")


@_attrs_define
class ApiError:
    """
    Attributes:
        error (str): Human-readable error message.
        meta (ApiMeta):
        issues (list[ApiErrorIssuesItem] | Unset): Field-level validation issues (present on 400 responses).
    """

    error: str
    meta: ApiMeta
    issues: list[ApiErrorIssuesItem] | Unset = UNSET
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

        api_error = cls(
            error=error,
            meta=meta,
            issues=issues,
        )

        api_error.additional_properties = d
        return api_error

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
