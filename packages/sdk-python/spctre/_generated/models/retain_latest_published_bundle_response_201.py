from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.api_meta import ApiMeta


T = TypeVar("T", bound="RetainLatestPublishedBundleResponse201")


@_attrs_define
class RetainLatestPublishedBundleResponse201:
    """
    Attributes:
        content_hash (str):
        publish_id (str):
        retained (bool):
        meta (ApiMeta):
    """

    content_hash: str
    publish_id: str
    retained: bool
    meta: ApiMeta
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        content_hash = self.content_hash

        publish_id = self.publish_id

        retained = self.retained

        meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "contentHash": content_hash,
                "publishId": publish_id,
                "retained": retained,
                "meta": meta,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_meta import ApiMeta

        d = dict(src_dict)
        content_hash = d.pop("contentHash")

        publish_id = d.pop("publishId")

        retained = d.pop("retained")

        meta = ApiMeta.from_dict(d.pop("meta"))

        retain_latest_published_bundle_response_201 = cls(
            content_hash=content_hash,
            publish_id=publish_id,
            retained=retained,
            meta=meta,
        )

        retain_latest_published_bundle_response_201.additional_properties = d
        return retain_latest_published_bundle_response_201

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
