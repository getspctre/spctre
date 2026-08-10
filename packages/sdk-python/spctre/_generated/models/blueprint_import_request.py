from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="BlueprintImportRequest")


@_attrs_define
class BlueprintImportRequest:
    """
    Attributes:
        source (str): The raw declarative Blueprint source document (YAML or JSON): an envelope of name, agentId,
            message, and definition. The definition names its governing policy branch via policyBranchId (a branch name) and
            must not pin policyRevisionId.
        source_path (str | Unset): Provenance path recorded with the revision.
    """

    source: str
    source_path: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        source = self.source

        source_path = self.source_path

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "source": source,
            }
        )
        if source_path is not UNSET:
            field_dict["sourcePath"] = source_path

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        source = d.pop("source")

        source_path = d.pop("sourcePath", UNSET)

        blueprint_import_request = cls(
            source=source,
            source_path=source_path,
        )

        blueprint_import_request.additional_properties = d
        return blueprint_import_request

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
