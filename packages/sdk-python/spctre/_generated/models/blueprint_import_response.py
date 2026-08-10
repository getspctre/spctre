from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.api_meta import ApiMeta


T = TypeVar("T", bound="BlueprintImportResponse")


@_attrs_define
class BlueprintImportResponse:
    """
    Attributes:
        blueprint_id (str):
        revision_id (str):
        definition_hash (str): SHA-256 of the bound Blueprint definition.
        created (bool): True when a brand-new Blueprint was created (HTTP 201).
        already_current (bool): True when a revision with this exact bound definition already existed; no write was
            performed.
        policy_branch_id (str): Resolved id of the governing policy branch.
        policy_revision_id (str): Resolved id of the branch's published revision the Blueprint is bound to.
        meta (ApiMeta):
    """

    blueprint_id: str
    revision_id: str
    definition_hash: str
    created: bool
    already_current: bool
    policy_branch_id: str
    policy_revision_id: str
    meta: ApiMeta
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        blueprint_id = self.blueprint_id

        revision_id = self.revision_id

        definition_hash = self.definition_hash

        created = self.created

        already_current = self.already_current

        policy_branch_id = self.policy_branch_id

        policy_revision_id = self.policy_revision_id

        meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "blueprintId": blueprint_id,
                "revisionId": revision_id,
                "definitionHash": definition_hash,
                "created": created,
                "alreadyCurrent": already_current,
                "policyBranchId": policy_branch_id,
                "policyRevisionId": policy_revision_id,
                "meta": meta,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_meta import ApiMeta

        d = dict(src_dict)
        blueprint_id = d.pop("blueprintId")

        revision_id = d.pop("revisionId")

        definition_hash = d.pop("definitionHash")

        created = d.pop("created")

        already_current = d.pop("alreadyCurrent")

        policy_branch_id = d.pop("policyBranchId")

        policy_revision_id = d.pop("policyRevisionId")

        meta = ApiMeta.from_dict(d.pop("meta"))

        blueprint_import_response = cls(
            blueprint_id=blueprint_id,
            revision_id=revision_id,
            definition_hash=definition_hash,
            created=created,
            already_current=already_current,
            policy_branch_id=policy_branch_id,
            policy_revision_id=policy_revision_id,
            meta=meta,
        )

        blueprint_import_response.additional_properties = d
        return blueprint_import_response

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
