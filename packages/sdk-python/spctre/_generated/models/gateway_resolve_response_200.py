from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.api_meta import ApiMeta


T = TypeVar("T", bound="GatewayResolveResponse200")


@_attrs_define
class GatewayResolveResponse200:
    """
    Attributes:
        ok (bool | Unset):
        meta (ApiMeta | Unset):
    """

    ok: bool | Unset = UNSET
    meta: ApiMeta | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        ok = self.ok

        meta: dict[str, Any] | Unset = UNSET
        if not isinstance(self.meta, Unset):
            meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if ok is not UNSET:
            field_dict["ok"] = ok
        if meta is not UNSET:
            field_dict["meta"] = meta

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_meta import ApiMeta

        d = dict(src_dict)
        ok = d.pop("ok", UNSET)

        _meta = d.pop("meta", UNSET)
        meta: ApiMeta | Unset
        if isinstance(_meta, Unset):
            meta = UNSET
        else:
            meta = ApiMeta.from_dict(_meta)

        gateway_resolve_response_200 = cls(
            ok=ok,
            meta=meta,
        )

        gateway_resolve_response_200.additional_properties = d
        return gateway_resolve_response_200

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
