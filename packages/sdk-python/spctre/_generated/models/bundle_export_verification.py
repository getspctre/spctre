from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="BundleExportVerification")


@_attrs_define
class BundleExportVerification:
    """
    Attributes:
        ok (bool):
        expected_hash (str):
        actual_hash (None | str):
        issues (list[str]):
    """

    ok: bool
    expected_hash: str
    actual_hash: None | str
    issues: list[str]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        ok = self.ok

        expected_hash = self.expected_hash

        actual_hash: None | str
        actual_hash = self.actual_hash

        issues = self.issues

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "ok": ok,
                "expectedHash": expected_hash,
                "actualHash": actual_hash,
                "issues": issues,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        ok = d.pop("ok")

        expected_hash = d.pop("expectedHash")

        def _parse_actual_hash(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        actual_hash = _parse_actual_hash(d.pop("actualHash"))

        issues = cast(list[str], d.pop("issues"))

        bundle_export_verification = cls(
            ok=ok,
            expected_hash=expected_hash,
            actual_hash=actual_hash,
            issues=issues,
        )

        bundle_export_verification.additional_properties = d
        return bundle_export_verification

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
