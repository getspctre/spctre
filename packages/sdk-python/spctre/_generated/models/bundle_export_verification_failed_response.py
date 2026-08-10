from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.api_meta import ApiMeta
    from ..models.bundle_export_manifest import BundleExportManifest
    from ..models.bundle_export_verification import BundleExportVerification


T = TypeVar("T", bound="BundleExportVerificationFailedResponse")


@_attrs_define
class BundleExportVerificationFailedResponse:
    """
    Attributes:
        error (str):
        verification (BundleExportVerification):
        manifest (BundleExportManifest):
        meta (ApiMeta):
    """

    error: str
    verification: BundleExportVerification
    manifest: BundleExportManifest
    meta: ApiMeta
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        error = self.error

        verification = self.verification.to_dict()

        manifest = self.manifest.to_dict()

        meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "error": error,
                "verification": verification,
                "manifest": manifest,
                "meta": meta,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_meta import ApiMeta
        from ..models.bundle_export_manifest import BundleExportManifest
        from ..models.bundle_export_verification import BundleExportVerification

        d = dict(src_dict)
        error = d.pop("error")

        verification = BundleExportVerification.from_dict(d.pop("verification"))

        manifest = BundleExportManifest.from_dict(d.pop("manifest"))

        meta = ApiMeta.from_dict(d.pop("meta"))

        bundle_export_verification_failed_response = cls(
            error=error,
            verification=verification,
            manifest=manifest,
            meta=meta,
        )

        bundle_export_verification_failed_response.additional_properties = d
        return bundle_export_verification_failed_response

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
