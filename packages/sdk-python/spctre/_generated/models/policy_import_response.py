from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.api_meta import ApiMeta


T = TypeVar("T", bound="PolicyImportResponse")


@_attrs_define
class PolicyImportResponse:
    """
    Attributes:
        branch_id (str):
        revision_id (str):
        source_hash (str): SHA-256 (truncated) of the imported source.
        created (bool): True when a brand-new branch was created (HTTP 201).
        already_current (bool): True when the branch head already carried this exact source; no write was performed.
        rule_count (int):
        meta (ApiMeta):
    """

    branch_id: str
    revision_id: str
    source_hash: str
    created: bool
    already_current: bool
    rule_count: int
    meta: ApiMeta
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        branch_id = self.branch_id

        revision_id = self.revision_id

        source_hash = self.source_hash

        created = self.created

        already_current = self.already_current

        rule_count = self.rule_count

        meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "branchId": branch_id,
                "revisionId": revision_id,
                "sourceHash": source_hash,
                "created": created,
                "alreadyCurrent": already_current,
                "ruleCount": rule_count,
                "meta": meta,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_meta import ApiMeta

        d = dict(src_dict)
        branch_id = d.pop("branchId")

        revision_id = d.pop("revisionId")

        source_hash = d.pop("sourceHash")

        created = d.pop("created")

        already_current = d.pop("alreadyCurrent")

        rule_count = d.pop("ruleCount")

        meta = ApiMeta.from_dict(d.pop("meta"))

        policy_import_response = cls(
            branch_id=branch_id,
            revision_id=revision_id,
            source_hash=source_hash,
            created=created,
            already_current=already_current,
            rule_count=rule_count,
            meta=meta,
        )

        policy_import_response.additional_properties = d
        return policy_import_response

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
