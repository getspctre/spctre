from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.api_meta import ApiMeta
    from ..models.bundle_export_manifest import BundleExportManifest


T = TypeVar("T", bound="BundleExportPreviewResponse")


@_attrs_define
class BundleExportPreviewResponse:
    """
    Attributes:
        formats (list[BundleExportManifest]):
        meta (ApiMeta):
    """

    formats: list[BundleExportManifest]
    meta: ApiMeta
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        formats = []
        for formats_item_data in self.formats:
            formats_item = formats_item_data.to_dict()
            formats.append(formats_item)

        meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "formats": formats,
                "meta": meta,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_meta import ApiMeta
        from ..models.bundle_export_manifest import BundleExportManifest

        d = dict(src_dict)
        formats = []
        _formats = d.pop("formats")
        for formats_item_data in _formats:
            formats_item = BundleExportManifest.from_dict(formats_item_data)

            formats.append(formats_item)

        meta = ApiMeta.from_dict(d.pop("meta"))

        bundle_export_preview_response = cls(
            formats=formats,
            meta=meta,
        )

        bundle_export_preview_response.additional_properties = d
        return bundle_export_preview_response

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
