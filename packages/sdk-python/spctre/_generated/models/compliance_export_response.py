from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.compliance_export_response_approvals_item import (
        ComplianceExportResponseApprovalsItem,
    )
    from ..models.compliance_export_response_artifact import (
        ComplianceExportResponseArtifact,
    )
    from ..models.compliance_export_response_escalations_item import (
        ComplianceExportResponseEscalationsItem,
    )
    from ..models.compliance_export_response_framework_annotation_type_0 import (
        ComplianceExportResponseFrameworkAnnotationType0,
    )
    from ..models.compliance_export_response_retention_plan_type_0 import (
        ComplianceExportResponseRetentionPlanType0,
    )
    from ..models.compliance_export_response_summary import (
        ComplianceExportResponseSummary,
    )
    from ..models.compliance_export_response_timeline_item import (
        ComplianceExportResponseTimelineItem,
    )
    from ..models.compliance_export_response_verification_results_type_0 import (
        ComplianceExportResponseVerificationResultsType0,
    )


T = TypeVar("T", bound="ComplianceExportResponse")


@_attrs_define
class ComplianceExportResponse:
    """
    Attributes:
        schema_version (str):
        exported_at (datetime.datetime):
        artifact (ComplianceExportResponseArtifact):
        summary (ComplianceExportResponseSummary):
        escalations (list[ComplianceExportResponseEscalationsItem]):
        verification_results (ComplianceExportResponseVerificationResultsType0 | None):
        framework_annotation (ComplianceExportResponseFrameworkAnnotationType0 | None):
        retention_plan (ComplianceExportResponseRetentionPlanType0 | None):
        approvals (list[ComplianceExportResponseApprovalsItem] | Unset):
        timeline (list[ComplianceExportResponseTimelineItem] | Unset):
    """

    schema_version: str
    exported_at: datetime.datetime
    artifact: ComplianceExportResponseArtifact
    summary: ComplianceExportResponseSummary
    escalations: list[ComplianceExportResponseEscalationsItem]
    verification_results: ComplianceExportResponseVerificationResultsType0 | None
    framework_annotation: ComplianceExportResponseFrameworkAnnotationType0 | None
    retention_plan: ComplianceExportResponseRetentionPlanType0 | None
    approvals: list[ComplianceExportResponseApprovalsItem] | Unset = UNSET
    timeline: list[ComplianceExportResponseTimelineItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.compliance_export_response_framework_annotation_type_0 import (
            ComplianceExportResponseFrameworkAnnotationType0,
        )
        from ..models.compliance_export_response_retention_plan_type_0 import (
            ComplianceExportResponseRetentionPlanType0,
        )
        from ..models.compliance_export_response_verification_results_type_0 import (
            ComplianceExportResponseVerificationResultsType0,
        )

        schema_version = self.schema_version

        exported_at = self.exported_at.isoformat()

        artifact = self.artifact.to_dict()

        summary = self.summary.to_dict()

        escalations = []
        for escalations_item_data in self.escalations:
            escalations_item = escalations_item_data.to_dict()
            escalations.append(escalations_item)

        verification_results: dict[str, Any] | None
        if isinstance(
            self.verification_results, ComplianceExportResponseVerificationResultsType0
        ):
            verification_results = self.verification_results.to_dict()
        else:
            verification_results = self.verification_results

        framework_annotation: dict[str, Any] | None
        if isinstance(
            self.framework_annotation, ComplianceExportResponseFrameworkAnnotationType0
        ):
            framework_annotation = self.framework_annotation.to_dict()
        else:
            framework_annotation = self.framework_annotation

        retention_plan: dict[str, Any] | None
        if isinstance(self.retention_plan, ComplianceExportResponseRetentionPlanType0):
            retention_plan = self.retention_plan.to_dict()
        else:
            retention_plan = self.retention_plan

        approvals: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.approvals, Unset):
            approvals = []
            for approvals_item_data in self.approvals:
                approvals_item = approvals_item_data.to_dict()
                approvals.append(approvals_item)

        timeline: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.timeline, Unset):
            timeline = []
            for timeline_item_data in self.timeline:
                timeline_item = timeline_item_data.to_dict()
                timeline.append(timeline_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "schemaVersion": schema_version,
                "exportedAt": exported_at,
                "artifact": artifact,
                "summary": summary,
                "escalations": escalations,
                "verificationResults": verification_results,
                "frameworkAnnotation": framework_annotation,
                "retentionPlan": retention_plan,
            }
        )
        if approvals is not UNSET:
            field_dict["approvals"] = approvals
        if timeline is not UNSET:
            field_dict["timeline"] = timeline

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.compliance_export_response_approvals_item import (
            ComplianceExportResponseApprovalsItem,
        )
        from ..models.compliance_export_response_artifact import (
            ComplianceExportResponseArtifact,
        )
        from ..models.compliance_export_response_escalations_item import (
            ComplianceExportResponseEscalationsItem,
        )
        from ..models.compliance_export_response_framework_annotation_type_0 import (
            ComplianceExportResponseFrameworkAnnotationType0,
        )
        from ..models.compliance_export_response_retention_plan_type_0 import (
            ComplianceExportResponseRetentionPlanType0,
        )
        from ..models.compliance_export_response_summary import (
            ComplianceExportResponseSummary,
        )
        from ..models.compliance_export_response_timeline_item import (
            ComplianceExportResponseTimelineItem,
        )
        from ..models.compliance_export_response_verification_results_type_0 import (
            ComplianceExportResponseVerificationResultsType0,
        )

        d = dict(src_dict)
        schema_version = d.pop("schemaVersion")

        exported_at = datetime.datetime.fromisoformat(d.pop("exportedAt"))

        artifact = ComplianceExportResponseArtifact.from_dict(d.pop("artifact"))

        summary = ComplianceExportResponseSummary.from_dict(d.pop("summary"))

        escalations = []
        _escalations = d.pop("escalations")
        for escalations_item_data in _escalations:
            escalations_item = ComplianceExportResponseEscalationsItem.from_dict(
                escalations_item_data
            )

            escalations.append(escalations_item)

        def _parse_verification_results(
            data: object,
        ) -> ComplianceExportResponseVerificationResultsType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                verification_results_type_0 = (
                    ComplianceExportResponseVerificationResultsType0.from_dict(data)
                )

                return verification_results_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(ComplianceExportResponseVerificationResultsType0 | None, data)

        verification_results = _parse_verification_results(d.pop("verificationResults"))

        def _parse_framework_annotation(
            data: object,
        ) -> ComplianceExportResponseFrameworkAnnotationType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                framework_annotation_type_0 = (
                    ComplianceExportResponseFrameworkAnnotationType0.from_dict(data)
                )

                return framework_annotation_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(ComplianceExportResponseFrameworkAnnotationType0 | None, data)

        framework_annotation = _parse_framework_annotation(d.pop("frameworkAnnotation"))

        def _parse_retention_plan(
            data: object,
        ) -> ComplianceExportResponseRetentionPlanType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                retention_plan_type_0 = (
                    ComplianceExportResponseRetentionPlanType0.from_dict(data)
                )

                return retention_plan_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(ComplianceExportResponseRetentionPlanType0 | None, data)

        retention_plan = _parse_retention_plan(d.pop("retentionPlan"))

        _approvals = d.pop("approvals", UNSET)
        approvals: list[ComplianceExportResponseApprovalsItem] | Unset = UNSET
        if _approvals is not UNSET:
            approvals = []
            for approvals_item_data in _approvals:
                approvals_item = ComplianceExportResponseApprovalsItem.from_dict(
                    approvals_item_data
                )

                approvals.append(approvals_item)

        _timeline = d.pop("timeline", UNSET)
        timeline: list[ComplianceExportResponseTimelineItem] | Unset = UNSET
        if _timeline is not UNSET:
            timeline = []
            for timeline_item_data in _timeline:
                timeline_item = ComplianceExportResponseTimelineItem.from_dict(
                    timeline_item_data
                )

                timeline.append(timeline_item)

        compliance_export_response = cls(
            schema_version=schema_version,
            exported_at=exported_at,
            artifact=artifact,
            summary=summary,
            escalations=escalations,
            verification_results=verification_results,
            framework_annotation=framework_annotation,
            retention_plan=retention_plan,
            approvals=approvals,
            timeline=timeline,
        )

        compliance_export_response.additional_properties = d
        return compliance_export_response

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
