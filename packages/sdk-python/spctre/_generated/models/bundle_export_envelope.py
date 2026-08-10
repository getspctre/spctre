from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.api_meta import ApiMeta
    from ..models.bundle_export_envelope_artifact_type_1 import (
        BundleExportEnvelopeArtifactType1,
    )
    from ..models.bundle_export_manifest import BundleExportManifest


T = TypeVar("T", bound="BundleExportEnvelope")


@_attrs_define
class BundleExportEnvelope:
    """
    Attributes:
        artifact (BundleExportEnvelopeArtifactType1 | str): Target artifact. String for text formats, object for
            JSON/bundle formats.
        manifest (BundleExportManifest):
        meta (ApiMeta):
    """

    artifact: BundleExportEnvelopeArtifactType1 | str
    manifest: BundleExportManifest
    meta: ApiMeta
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.bundle_export_envelope_artifact_type_1 import (
            BundleExportEnvelopeArtifactType1,
        )

        artifact: dict[str, Any] | str
        if isinstance(self.artifact, BundleExportEnvelopeArtifactType1):
            artifact = self.artifact.to_dict()
        else:
            artifact = self.artifact

        manifest = self.manifest.to_dict()

        meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "artifact": artifact,
                "manifest": manifest,
                "meta": meta,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_meta import ApiMeta
        from ..models.bundle_export_envelope_artifact_type_1 import (
            BundleExportEnvelopeArtifactType1,
        )
        from ..models.bundle_export_manifest import BundleExportManifest

        d = dict(src_dict)

        def _parse_artifact(data: object) -> BundleExportEnvelopeArtifactType1 | str:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                artifact_type_1 = BundleExportEnvelopeArtifactType1.from_dict(data)

                return artifact_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(BundleExportEnvelopeArtifactType1 | str, data)

        artifact = _parse_artifact(d.pop("artifact"))

        manifest = BundleExportManifest.from_dict(d.pop("manifest"))

        meta = ApiMeta.from_dict(d.pop("meta"))

        bundle_export_envelope = cls(
            artifact=artifact,
            manifest=manifest,
            meta=meta,
        )

        bundle_export_envelope.additional_properties = d
        return bundle_export_envelope

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
