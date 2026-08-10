from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.bundle_export_format import BundleExportFormat
from ..models.bundle_export_manifest_compatibility_level import (
    BundleExportManifestCompatibilityLevel,
)

if TYPE_CHECKING:
    from ..models.bundle_export_manifest_provenance import (
        BundleExportManifestProvenance,
    )


T = TypeVar("T", bound="BundleExportManifest")


@_attrs_define
class BundleExportManifest:
    """
    Attributes:
        format_ (BundleExportFormat):
        target (str):
        compatibility_level (BundleExportManifestCompatibilityLevel):
        semantic_warnings (list[str]):
        blocking_warnings (list[str]):
        verification_targets (list[str]):
        artifact_hash (str):
        compiled_artifact_hash (str):
        generated_at (datetime.datetime):
        provenance (BundleExportManifestProvenance):
        rule_count (int):
    """

    format_: BundleExportFormat
    target: str
    compatibility_level: BundleExportManifestCompatibilityLevel
    semantic_warnings: list[str]
    blocking_warnings: list[str]
    verification_targets: list[str]
    artifact_hash: str
    compiled_artifact_hash: str
    generated_at: datetime.datetime
    provenance: BundleExportManifestProvenance
    rule_count: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        format_ = self.format_.value

        target = self.target

        compatibility_level = self.compatibility_level.value

        semantic_warnings = self.semantic_warnings

        blocking_warnings = self.blocking_warnings

        verification_targets = self.verification_targets

        artifact_hash = self.artifact_hash

        compiled_artifact_hash = self.compiled_artifact_hash

        generated_at = self.generated_at.isoformat()

        provenance = self.provenance.to_dict()

        rule_count = self.rule_count

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "format": format_,
                "target": target,
                "compatibilityLevel": compatibility_level,
                "semanticWarnings": semantic_warnings,
                "blockingWarnings": blocking_warnings,
                "verificationTargets": verification_targets,
                "artifactHash": artifact_hash,
                "compiledArtifactHash": compiled_artifact_hash,
                "generatedAt": generated_at,
                "provenance": provenance,
                "ruleCount": rule_count,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.bundle_export_manifest_provenance import (
            BundleExportManifestProvenance,
        )

        d = dict(src_dict)
        format_ = BundleExportFormat(d.pop("format"))

        target = d.pop("target")

        compatibility_level = BundleExportManifestCompatibilityLevel(
            d.pop("compatibilityLevel")
        )

        semantic_warnings = cast(list[str], d.pop("semanticWarnings"))

        blocking_warnings = cast(list[str], d.pop("blockingWarnings"))

        verification_targets = cast(list[str], d.pop("verificationTargets"))

        artifact_hash = d.pop("artifactHash")

        compiled_artifact_hash = d.pop("compiledArtifactHash")

        generated_at = datetime.datetime.fromisoformat(d.pop("generatedAt"))

        provenance = BundleExportManifestProvenance.from_dict(d.pop("provenance"))

        rule_count = d.pop("ruleCount")

        bundle_export_manifest = cls(
            format_=format_,
            target=target,
            compatibility_level=compatibility_level,
            semantic_warnings=semantic_warnings,
            blocking_warnings=blocking_warnings,
            verification_targets=verification_targets,
            artifact_hash=artifact_hash,
            compiled_artifact_hash=compiled_artifact_hash,
            generated_at=generated_at,
            provenance=provenance,
            rule_count=rule_count,
        )

        bundle_export_manifest.additional_properties = d
        return bundle_export_manifest

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
