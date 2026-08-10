from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.api_meta import ApiMeta
    from ..models.evaluate_response_result import EvaluateResponseResult


T = TypeVar("T", bound="EvaluateResponse")


@_attrs_define
class EvaluateResponse:
    """
    Attributes:
        connector (str):
        action (str):
        result (EvaluateResponseResult): Policy evaluation result from the published bundle.
        meta (ApiMeta):
        domains (list[str] | Unset):
        branch_id (str | Unset):
        revision_id (str | Unset):
        artifact_hash (str | Unset):
        published_at (datetime.datetime | Unset):
    """

    connector: str
    action: str
    result: EvaluateResponseResult
    meta: ApiMeta
    domains: list[str] | Unset = UNSET
    branch_id: str | Unset = UNSET
    revision_id: str | Unset = UNSET
    artifact_hash: str | Unset = UNSET
    published_at: datetime.datetime | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        connector = self.connector

        action = self.action

        result = self.result.to_dict()

        meta = self.meta.to_dict()

        domains: list[str] | Unset = UNSET
        if not isinstance(self.domains, Unset):
            domains = self.domains

        branch_id = self.branch_id

        revision_id = self.revision_id

        artifact_hash = self.artifact_hash

        published_at: str | Unset = UNSET
        if not isinstance(self.published_at, Unset):
            published_at = self.published_at.isoformat()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "connector": connector,
                "action": action,
                "result": result,
                "meta": meta,
            }
        )
        if domains is not UNSET:
            field_dict["domains"] = domains
        if branch_id is not UNSET:
            field_dict["branchId"] = branch_id
        if revision_id is not UNSET:
            field_dict["revisionId"] = revision_id
        if artifact_hash is not UNSET:
            field_dict["artifactHash"] = artifact_hash
        if published_at is not UNSET:
            field_dict["publishedAt"] = published_at

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_meta import ApiMeta
        from ..models.evaluate_response_result import EvaluateResponseResult

        d = dict(src_dict)
        connector = d.pop("connector")

        action = d.pop("action")

        result = EvaluateResponseResult.from_dict(d.pop("result"))

        meta = ApiMeta.from_dict(d.pop("meta"))

        domains = cast(list[str], d.pop("domains", UNSET))

        branch_id = d.pop("branchId", UNSET)

        revision_id = d.pop("revisionId", UNSET)

        artifact_hash = d.pop("artifactHash", UNSET)

        _published_at = d.pop("publishedAt", UNSET)
        published_at: datetime.datetime | Unset
        if isinstance(_published_at, Unset):
            published_at = UNSET
        else:
            published_at = datetime.datetime.fromisoformat(_published_at)

        evaluate_response = cls(
            connector=connector,
            action=action,
            result=result,
            meta=meta,
            domains=domains,
            branch_id=branch_id,
            revision_id=revision_id,
            artifact_hash=artifact_hash,
            published_at=published_at,
        )

        evaluate_response.additional_properties = d
        return evaluate_response

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
