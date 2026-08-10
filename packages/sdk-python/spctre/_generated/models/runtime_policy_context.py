from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.runtime_policy_context_scope import RuntimePolicyContextScope
from ..types import UNSET, Unset

T = TypeVar("T", bound="RuntimePolicyContext")


@_attrs_define
class RuntimePolicyContext:
    """
    Attributes:
        scope (RuntimePolicyContextScope):
        branch_id (str):
        revision_id (str):
        artifact_hash (str):
        pack_id (str | Unset):
        pack_version (str | Unset):
        pack_owner (str | Unset):
    """

    scope: RuntimePolicyContextScope
    branch_id: str
    revision_id: str
    artifact_hash: str
    pack_id: str | Unset = UNSET
    pack_version: str | Unset = UNSET
    pack_owner: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        scope = self.scope.value

        branch_id = self.branch_id

        revision_id = self.revision_id

        artifact_hash = self.artifact_hash

        pack_id = self.pack_id

        pack_version = self.pack_version

        pack_owner = self.pack_owner

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "scope": scope,
                "branchId": branch_id,
                "revisionId": revision_id,
                "artifactHash": artifact_hash,
            }
        )
        if pack_id is not UNSET:
            field_dict["packId"] = pack_id
        if pack_version is not UNSET:
            field_dict["packVersion"] = pack_version
        if pack_owner is not UNSET:
            field_dict["packOwner"] = pack_owner

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        scope = RuntimePolicyContextScope(d.pop("scope"))

        branch_id = d.pop("branchId")

        revision_id = d.pop("revisionId")

        artifact_hash = d.pop("artifactHash")

        pack_id = d.pop("packId", UNSET)

        pack_version = d.pop("packVersion", UNSET)

        pack_owner = d.pop("packOwner", UNSET)

        runtime_policy_context = cls(
            scope=scope,
            branch_id=branch_id,
            revision_id=revision_id,
            artifact_hash=artifact_hash,
            pack_id=pack_id,
            pack_version=pack_version,
            pack_owner=pack_owner,
        )

        runtime_policy_context.additional_properties = d
        return runtime_policy_context

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
