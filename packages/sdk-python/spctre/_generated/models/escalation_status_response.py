from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.escalation_status_response_resolution_outcome import (
    EscalationStatusResponseResolutionOutcome,
)
from ..models.escalation_status_response_status import EscalationStatusResponseStatus
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.api_meta import ApiMeta
    from ..models.credential_grant import CredentialGrant
    from ..models.escalation_status_response_approved_tool_parameters import (
        EscalationStatusResponseApprovedToolParameters,
    )


T = TypeVar("T", bound="EscalationStatusResponse")


@_attrs_define
class EscalationStatusResponse:
    """
    Attributes:
        decision_id (str):
        status (EscalationStatusResponseStatus):
        meta (ApiMeta):
        resolution_outcome (EscalationStatusResponseResolutionOutcome | Unset):
        resolution_note (None | str | Unset):
        agent_guidance (None | str | Unset):
        sla_due_at (datetime.datetime | None | Unset):
        resolved_at (datetime.datetime | None | Unset):
        approved_tool_parameters (EscalationStatusResponseApprovedToolParameters | Unset): Confirmation of the decision
            arguments a human reviewed — not an execution source. Sensitive keys are redacted and depth/size are bounded
            when the decision is recorded, so this is a lossy snapshot: execute from your own parameters and use this to
            confirm they match what was approved. Present only when the escalation is RESOLVED with a PROCEED outcome.
        credential_grant (CredentialGrant | Unset):
    """

    decision_id: str
    status: EscalationStatusResponseStatus
    meta: ApiMeta
    resolution_outcome: EscalationStatusResponseResolutionOutcome | Unset = UNSET
    resolution_note: None | str | Unset = UNSET
    agent_guidance: None | str | Unset = UNSET
    sla_due_at: datetime.datetime | None | Unset = UNSET
    resolved_at: datetime.datetime | None | Unset = UNSET
    approved_tool_parameters: EscalationStatusResponseApprovedToolParameters | Unset = (
        UNSET
    )
    credential_grant: CredentialGrant | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        decision_id = self.decision_id

        status = self.status.value

        meta = self.meta.to_dict()

        resolution_outcome: str | Unset = UNSET
        if not isinstance(self.resolution_outcome, Unset):
            resolution_outcome = self.resolution_outcome.value

        resolution_note: None | str | Unset
        if isinstance(self.resolution_note, Unset):
            resolution_note = UNSET
        else:
            resolution_note = self.resolution_note

        agent_guidance: None | str | Unset
        if isinstance(self.agent_guidance, Unset):
            agent_guidance = UNSET
        else:
            agent_guidance = self.agent_guidance

        sla_due_at: None | str | Unset
        if isinstance(self.sla_due_at, Unset):
            sla_due_at = UNSET
        elif isinstance(self.sla_due_at, datetime.datetime):
            sla_due_at = self.sla_due_at.isoformat()
        else:
            sla_due_at = self.sla_due_at

        resolved_at: None | str | Unset
        if isinstance(self.resolved_at, Unset):
            resolved_at = UNSET
        elif isinstance(self.resolved_at, datetime.datetime):
            resolved_at = self.resolved_at.isoformat()
        else:
            resolved_at = self.resolved_at

        approved_tool_parameters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.approved_tool_parameters, Unset):
            approved_tool_parameters = self.approved_tool_parameters.to_dict()

        credential_grant: dict[str, Any] | Unset = UNSET
        if not isinstance(self.credential_grant, Unset):
            credential_grant = self.credential_grant.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "decisionId": decision_id,
                "status": status,
                "meta": meta,
            }
        )
        if resolution_outcome is not UNSET:
            field_dict["resolutionOutcome"] = resolution_outcome
        if resolution_note is not UNSET:
            field_dict["resolutionNote"] = resolution_note
        if agent_guidance is not UNSET:
            field_dict["agentGuidance"] = agent_guidance
        if sla_due_at is not UNSET:
            field_dict["slaDueAt"] = sla_due_at
        if resolved_at is not UNSET:
            field_dict["resolvedAt"] = resolved_at
        if approved_tool_parameters is not UNSET:
            field_dict["approvedToolParameters"] = approved_tool_parameters
        if credential_grant is not UNSET:
            field_dict["credentialGrant"] = credential_grant

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_meta import ApiMeta
        from ..models.credential_grant import CredentialGrant
        from ..models.escalation_status_response_approved_tool_parameters import (
            EscalationStatusResponseApprovedToolParameters,
        )

        d = dict(src_dict)
        decision_id = d.pop("decisionId")

        status = EscalationStatusResponseStatus(d.pop("status"))

        meta = ApiMeta.from_dict(d.pop("meta"))

        _resolution_outcome = d.pop("resolutionOutcome", UNSET)
        resolution_outcome: EscalationStatusResponseResolutionOutcome | Unset
        if isinstance(_resolution_outcome, Unset):
            resolution_outcome = UNSET
        else:
            resolution_outcome = EscalationStatusResponseResolutionOutcome(
                _resolution_outcome
            )

        def _parse_resolution_note(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        resolution_note = _parse_resolution_note(d.pop("resolutionNote", UNSET))

        def _parse_agent_guidance(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        agent_guidance = _parse_agent_guidance(d.pop("agentGuidance", UNSET))

        def _parse_sla_due_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                sla_due_at_type_0 = datetime.datetime.fromisoformat(data)

                return sla_due_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        sla_due_at = _parse_sla_due_at(d.pop("slaDueAt", UNSET))

        def _parse_resolved_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                resolved_at_type_0 = datetime.datetime.fromisoformat(data)

                return resolved_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        resolved_at = _parse_resolved_at(d.pop("resolvedAt", UNSET))

        _approved_tool_parameters = d.pop("approvedToolParameters", UNSET)
        approved_tool_parameters: EscalationStatusResponseApprovedToolParameters | Unset
        if isinstance(_approved_tool_parameters, Unset):
            approved_tool_parameters = UNSET
        else:
            approved_tool_parameters = (
                EscalationStatusResponseApprovedToolParameters.from_dict(
                    _approved_tool_parameters
                )
            )

        _credential_grant = d.pop("credentialGrant", UNSET)
        credential_grant: CredentialGrant | Unset
        if isinstance(_credential_grant, Unset):
            credential_grant = UNSET
        else:
            credential_grant = CredentialGrant.from_dict(_credential_grant)

        escalation_status_response = cls(
            decision_id=decision_id,
            status=status,
            meta=meta,
            resolution_outcome=resolution_outcome,
            resolution_note=resolution_note,
            agent_guidance=agent_guidance,
            sla_due_at=sla_due_at,
            resolved_at=resolved_at,
            approved_tool_parameters=approved_tool_parameters,
            credential_grant=credential_grant,
        )

        escalation_status_response.additional_properties = d
        return escalation_status_response

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
