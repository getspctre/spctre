from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="EvidenceIngestRequestOrchestratorRef")


@_attrs_define
class EvidenceIngestRequestOrchestratorRef:
    """Orchestrator-platform reference (e.g. Paperclip companyId, issueId, goalId).

    Attributes:
        platform (str):
        company_id (str | Unset):
        issue_id (str | Unset):
        goal_id (str | Unset):
    """

    platform: str
    company_id: str | Unset = UNSET
    issue_id: str | Unset = UNSET
    goal_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        platform = self.platform

        company_id = self.company_id

        issue_id = self.issue_id

        goal_id = self.goal_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "platform": platform,
            }
        )
        if company_id is not UNSET:
            field_dict["companyId"] = company_id
        if issue_id is not UNSET:
            field_dict["issueId"] = issue_id
        if goal_id is not UNSET:
            field_dict["goalId"] = goal_id

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        platform = d.pop("platform")

        company_id = d.pop("companyId", UNSET)

        issue_id = d.pop("issueId", UNSET)

        goal_id = d.pop("goalId", UNSET)

        evidence_ingest_request_orchestrator_ref = cls(
            platform=platform,
            company_id=company_id,
            issue_id=issue_id,
            goal_id=goal_id,
        )

        evidence_ingest_request_orchestrator_ref.additional_properties = d
        return evidence_ingest_request_orchestrator_ref

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
