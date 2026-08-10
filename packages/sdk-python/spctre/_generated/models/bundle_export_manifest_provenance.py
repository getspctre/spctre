from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.bundle_export_manifest_provenance_target_stacks_item import (
        BundleExportManifestProvenanceTargetStacksItem,
    )


T = TypeVar("T", bound="BundleExportManifestProvenance")


@_attrs_define
class BundleExportManifestProvenance:
    """
    Attributes:
        tenant_id (str):
        workspace_id (None | str):
        branch_id (str):
        revision_id (str):
        source_hash (str):
        source_format (str):
        target_stacks (list[BundleExportManifestProvenanceTargetStacksItem]):
        source_path (str | Unset):
    """

    tenant_id: str
    workspace_id: None | str
    branch_id: str
    revision_id: str
    source_hash: str
    source_format: str
    target_stacks: list[BundleExportManifestProvenanceTargetStacksItem]
    source_path: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        tenant_id = self.tenant_id

        workspace_id: None | str
        workspace_id = self.workspace_id

        branch_id = self.branch_id

        revision_id = self.revision_id

        source_hash = self.source_hash

        source_format = self.source_format

        target_stacks = []
        for target_stacks_item_data in self.target_stacks:
            target_stacks_item = target_stacks_item_data.to_dict()
            target_stacks.append(target_stacks_item)

        source_path = self.source_path

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "tenantId": tenant_id,
                "workspaceId": workspace_id,
                "branchId": branch_id,
                "revisionId": revision_id,
                "sourceHash": source_hash,
                "sourceFormat": source_format,
                "targetStacks": target_stacks,
            }
        )
        if source_path is not UNSET:
            field_dict["sourcePath"] = source_path

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.bundle_export_manifest_provenance_target_stacks_item import (
            BundleExportManifestProvenanceTargetStacksItem,
        )

        d = dict(src_dict)
        tenant_id = d.pop("tenantId")

        def _parse_workspace_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        workspace_id = _parse_workspace_id(d.pop("workspaceId"))

        branch_id = d.pop("branchId")

        revision_id = d.pop("revisionId")

        source_hash = d.pop("sourceHash")

        source_format = d.pop("sourceFormat")

        target_stacks = []
        _target_stacks = d.pop("targetStacks")
        for target_stacks_item_data in _target_stacks:
            target_stacks_item = (
                BundleExportManifestProvenanceTargetStacksItem.from_dict(
                    target_stacks_item_data
                )
            )

            target_stacks.append(target_stacks_item)

        source_path = d.pop("sourcePath", UNSET)

        bundle_export_manifest_provenance = cls(
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            branch_id=branch_id,
            revision_id=revision_id,
            source_hash=source_hash,
            source_format=source_format,
            target_stacks=target_stacks,
            source_path=source_path,
        )

        bundle_export_manifest_provenance.additional_properties = d
        return bundle_export_manifest_provenance

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
