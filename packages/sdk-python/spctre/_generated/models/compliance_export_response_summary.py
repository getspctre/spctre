from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="ComplianceExportResponseSummary")


@_attrs_define
class ComplianceExportResponseSummary:
    """
    Attributes:
        evidence_count (int | Unset):
        approval_count (int | Unset):
        policy_ref_count (int | Unset):
        denied_decision_count (int | Unset):
        warned_decision_count (int | Unset):
        simulation_event_count (int | Unset):
        package_sections (list[str] | Unset):
        resolved_escalation_count (int | Unset):
    """

    evidence_count: int | Unset = UNSET
    approval_count: int | Unset = UNSET
    policy_ref_count: int | Unset = UNSET
    denied_decision_count: int | Unset = UNSET
    warned_decision_count: int | Unset = UNSET
    simulation_event_count: int | Unset = UNSET
    package_sections: list[str] | Unset = UNSET
    resolved_escalation_count: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        evidence_count = self.evidence_count

        approval_count = self.approval_count

        policy_ref_count = self.policy_ref_count

        denied_decision_count = self.denied_decision_count

        warned_decision_count = self.warned_decision_count

        simulation_event_count = self.simulation_event_count

        package_sections: list[str] | Unset = UNSET
        if not isinstance(self.package_sections, Unset):
            package_sections = self.package_sections

        resolved_escalation_count = self.resolved_escalation_count

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if evidence_count is not UNSET:
            field_dict["evidenceCount"] = evidence_count
        if approval_count is not UNSET:
            field_dict["approvalCount"] = approval_count
        if policy_ref_count is not UNSET:
            field_dict["policyRefCount"] = policy_ref_count
        if denied_decision_count is not UNSET:
            field_dict["deniedDecisionCount"] = denied_decision_count
        if warned_decision_count is not UNSET:
            field_dict["warnedDecisionCount"] = warned_decision_count
        if simulation_event_count is not UNSET:
            field_dict["simulationEventCount"] = simulation_event_count
        if package_sections is not UNSET:
            field_dict["packageSections"] = package_sections
        if resolved_escalation_count is not UNSET:
            field_dict["resolvedEscalationCount"] = resolved_escalation_count

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        evidence_count = d.pop("evidenceCount", UNSET)

        approval_count = d.pop("approvalCount", UNSET)

        policy_ref_count = d.pop("policyRefCount", UNSET)

        denied_decision_count = d.pop("deniedDecisionCount", UNSET)

        warned_decision_count = d.pop("warnedDecisionCount", UNSET)

        simulation_event_count = d.pop("simulationEventCount", UNSET)

        package_sections = cast(list[str], d.pop("packageSections", UNSET))

        resolved_escalation_count = d.pop("resolvedEscalationCount", UNSET)

        compliance_export_response_summary = cls(
            evidence_count=evidence_count,
            approval_count=approval_count,
            policy_ref_count=policy_ref_count,
            denied_decision_count=denied_decision_count,
            warned_decision_count=warned_decision_count,
            simulation_event_count=simulation_event_count,
            package_sections=package_sections,
            resolved_escalation_count=resolved_escalation_count,
        )

        compliance_export_response_summary.additional_properties = d
        return compliance_export_response_summary

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
