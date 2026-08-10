from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.verification_ingest_request_compatibility_check_outcome import (
    VerificationIngestRequestCompatibilityCheckOutcome,
)
from ..models.verification_ingest_request_escrow_verification_outcome import (
    VerificationIngestRequestEscrowVerificationOutcome,
)
from ..models.verification_ingest_request_outcome import (
    VerificationIngestRequestOutcome,
)
from ..models.verification_ingest_request_verification_type import (
    VerificationIngestRequestVerificationType,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.verification_ingest_request_summary import (
        VerificationIngestRequestSummary,
    )


T = TypeVar("T", bound="VerificationIngestRequest")


@_attrs_define
class VerificationIngestRequest:
    """
    Attributes:
        artifact_hash (str):
        verification_type (VerificationIngestRequestVerificationType):
        outcome (VerificationIngestRequestOutcome):
        revision_id (str | Unset):
        runtime_version (str | Unset):
        verifier_id (str | Unset): Verifier implementation identity.
        verifier_digest (str | Unset): Immutable verifier build or configuration digest.
        arguments_hash (str | Unset):
        approver_did (str | Unset):
        policy_version (str | Unset):
        issued_at (datetime.datetime | Unset):
        completed_at (datetime.datetime | Unset):
        agt_version (str | Unset):
        agt_policies_version (str | Unset):
        cedar_policy_version (str | Unset):
        policy_engine_version (str | Unset):
        compatibility_checked_at (datetime.datetime | Unset):
        compatibility_check_outcome (VerificationIngestRequestCompatibilityCheckOutcome | Unset):
        escrow_signer_id (str | Unset):
        escrow_key_id (str | Unset):
        outcome_hash (str | Unset):
        escrow_signature (str | Unset):
        escrow_verification_outcome (VerificationIngestRequestEscrowVerificationOutcome | Unset):
        escrow_verified_at (datetime.datetime | Unset):
        summary (VerificationIngestRequestSummary | Unset): Arbitrary verification summary payload.
    """

    artifact_hash: str
    verification_type: VerificationIngestRequestVerificationType
    outcome: VerificationIngestRequestOutcome
    revision_id: str | Unset = UNSET
    runtime_version: str | Unset = UNSET
    verifier_id: str | Unset = UNSET
    verifier_digest: str | Unset = UNSET
    arguments_hash: str | Unset = UNSET
    approver_did: str | Unset = UNSET
    policy_version: str | Unset = UNSET
    issued_at: datetime.datetime | Unset = UNSET
    completed_at: datetime.datetime | Unset = UNSET
    agt_version: str | Unset = UNSET
    agt_policies_version: str | Unset = UNSET
    cedar_policy_version: str | Unset = UNSET
    policy_engine_version: str | Unset = UNSET
    compatibility_checked_at: datetime.datetime | Unset = UNSET
    compatibility_check_outcome: (
        VerificationIngestRequestCompatibilityCheckOutcome | Unset
    ) = UNSET
    escrow_signer_id: str | Unset = UNSET
    escrow_key_id: str | Unset = UNSET
    outcome_hash: str | Unset = UNSET
    escrow_signature: str | Unset = UNSET
    escrow_verification_outcome: (
        VerificationIngestRequestEscrowVerificationOutcome | Unset
    ) = UNSET
    escrow_verified_at: datetime.datetime | Unset = UNSET
    summary: VerificationIngestRequestSummary | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        artifact_hash = self.artifact_hash

        verification_type = self.verification_type.value

        outcome = self.outcome.value

        revision_id = self.revision_id

        runtime_version = self.runtime_version

        verifier_id = self.verifier_id

        verifier_digest = self.verifier_digest

        arguments_hash = self.arguments_hash

        approver_did = self.approver_did

        policy_version = self.policy_version

        issued_at: str | Unset = UNSET
        if not isinstance(self.issued_at, Unset):
            issued_at = self.issued_at.isoformat()

        completed_at: str | Unset = UNSET
        if not isinstance(self.completed_at, Unset):
            completed_at = self.completed_at.isoformat()

        agt_version = self.agt_version

        agt_policies_version = self.agt_policies_version

        cedar_policy_version = self.cedar_policy_version

        policy_engine_version = self.policy_engine_version

        compatibility_checked_at: str | Unset = UNSET
        if not isinstance(self.compatibility_checked_at, Unset):
            compatibility_checked_at = self.compatibility_checked_at.isoformat()

        compatibility_check_outcome: str | Unset = UNSET
        if not isinstance(self.compatibility_check_outcome, Unset):
            compatibility_check_outcome = self.compatibility_check_outcome.value

        escrow_signer_id = self.escrow_signer_id

        escrow_key_id = self.escrow_key_id

        outcome_hash = self.outcome_hash

        escrow_signature = self.escrow_signature

        escrow_verification_outcome: str | Unset = UNSET
        if not isinstance(self.escrow_verification_outcome, Unset):
            escrow_verification_outcome = self.escrow_verification_outcome.value

        escrow_verified_at: str | Unset = UNSET
        if not isinstance(self.escrow_verified_at, Unset):
            escrow_verified_at = self.escrow_verified_at.isoformat()

        summary: dict[str, Any] | Unset = UNSET
        if not isinstance(self.summary, Unset):
            summary = self.summary.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "artifactHash": artifact_hash,
                "verificationType": verification_type,
                "outcome": outcome,
            }
        )
        if revision_id is not UNSET:
            field_dict["revisionId"] = revision_id
        if runtime_version is not UNSET:
            field_dict["runtimeVersion"] = runtime_version
        if verifier_id is not UNSET:
            field_dict["verifierId"] = verifier_id
        if verifier_digest is not UNSET:
            field_dict["verifierDigest"] = verifier_digest
        if arguments_hash is not UNSET:
            field_dict["argumentsHash"] = arguments_hash
        if approver_did is not UNSET:
            field_dict["approverDid"] = approver_did
        if policy_version is not UNSET:
            field_dict["policyVersion"] = policy_version
        if issued_at is not UNSET:
            field_dict["issuedAt"] = issued_at
        if completed_at is not UNSET:
            field_dict["completedAt"] = completed_at
        if agt_version is not UNSET:
            field_dict["agtVersion"] = agt_version
        if agt_policies_version is not UNSET:
            field_dict["agtPoliciesVersion"] = agt_policies_version
        if cedar_policy_version is not UNSET:
            field_dict["cedarPolicyVersion"] = cedar_policy_version
        if policy_engine_version is not UNSET:
            field_dict["policyEngineVersion"] = policy_engine_version
        if compatibility_checked_at is not UNSET:
            field_dict["compatibilityCheckedAt"] = compatibility_checked_at
        if compatibility_check_outcome is not UNSET:
            field_dict["compatibilityCheckOutcome"] = compatibility_check_outcome
        if escrow_signer_id is not UNSET:
            field_dict["escrowSignerId"] = escrow_signer_id
        if escrow_key_id is not UNSET:
            field_dict["escrowKeyId"] = escrow_key_id
        if outcome_hash is not UNSET:
            field_dict["outcomeHash"] = outcome_hash
        if escrow_signature is not UNSET:
            field_dict["escrowSignature"] = escrow_signature
        if escrow_verification_outcome is not UNSET:
            field_dict["escrowVerificationOutcome"] = escrow_verification_outcome
        if escrow_verified_at is not UNSET:
            field_dict["escrowVerifiedAt"] = escrow_verified_at
        if summary is not UNSET:
            field_dict["summary"] = summary

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.verification_ingest_request_summary import (
            VerificationIngestRequestSummary,
        )

        d = dict(src_dict)
        artifact_hash = d.pop("artifactHash")

        verification_type = VerificationIngestRequestVerificationType(
            d.pop("verificationType")
        )

        outcome = VerificationIngestRequestOutcome(d.pop("outcome"))

        revision_id = d.pop("revisionId", UNSET)

        runtime_version = d.pop("runtimeVersion", UNSET)

        verifier_id = d.pop("verifierId", UNSET)

        verifier_digest = d.pop("verifierDigest", UNSET)

        arguments_hash = d.pop("argumentsHash", UNSET)

        approver_did = d.pop("approverDid", UNSET)

        policy_version = d.pop("policyVersion", UNSET)

        _issued_at = d.pop("issuedAt", UNSET)
        issued_at: datetime.datetime | Unset
        if isinstance(_issued_at, Unset):
            issued_at = UNSET
        else:
            issued_at = datetime.datetime.fromisoformat(_issued_at)

        _completed_at = d.pop("completedAt", UNSET)
        completed_at: datetime.datetime | Unset
        if isinstance(_completed_at, Unset):
            completed_at = UNSET
        else:
            completed_at = datetime.datetime.fromisoformat(_completed_at)

        agt_version = d.pop("agtVersion", UNSET)

        agt_policies_version = d.pop("agtPoliciesVersion", UNSET)

        cedar_policy_version = d.pop("cedarPolicyVersion", UNSET)

        policy_engine_version = d.pop("policyEngineVersion", UNSET)

        _compatibility_checked_at = d.pop("compatibilityCheckedAt", UNSET)
        compatibility_checked_at: datetime.datetime | Unset
        if isinstance(_compatibility_checked_at, Unset):
            compatibility_checked_at = UNSET
        else:
            compatibility_checked_at = datetime.datetime.fromisoformat(
                _compatibility_checked_at
            )

        _compatibility_check_outcome = d.pop("compatibilityCheckOutcome", UNSET)
        compatibility_check_outcome: (
            VerificationIngestRequestCompatibilityCheckOutcome | Unset
        )
        if isinstance(_compatibility_check_outcome, Unset):
            compatibility_check_outcome = UNSET
        else:
            compatibility_check_outcome = (
                VerificationIngestRequestCompatibilityCheckOutcome(
                    _compatibility_check_outcome
                )
            )

        escrow_signer_id = d.pop("escrowSignerId", UNSET)

        escrow_key_id = d.pop("escrowKeyId", UNSET)

        outcome_hash = d.pop("outcomeHash", UNSET)

        escrow_signature = d.pop("escrowSignature", UNSET)

        _escrow_verification_outcome = d.pop("escrowVerificationOutcome", UNSET)
        escrow_verification_outcome: (
            VerificationIngestRequestEscrowVerificationOutcome | Unset
        )
        if isinstance(_escrow_verification_outcome, Unset):
            escrow_verification_outcome = UNSET
        else:
            escrow_verification_outcome = (
                VerificationIngestRequestEscrowVerificationOutcome(
                    _escrow_verification_outcome
                )
            )

        _escrow_verified_at = d.pop("escrowVerifiedAt", UNSET)
        escrow_verified_at: datetime.datetime | Unset
        if isinstance(_escrow_verified_at, Unset):
            escrow_verified_at = UNSET
        else:
            escrow_verified_at = datetime.datetime.fromisoformat(_escrow_verified_at)

        _summary = d.pop("summary", UNSET)
        summary: VerificationIngestRequestSummary | Unset
        if isinstance(_summary, Unset):
            summary = UNSET
        else:
            summary = VerificationIngestRequestSummary.from_dict(_summary)

        verification_ingest_request = cls(
            artifact_hash=artifact_hash,
            verification_type=verification_type,
            outcome=outcome,
            revision_id=revision_id,
            runtime_version=runtime_version,
            verifier_id=verifier_id,
            verifier_digest=verifier_digest,
            arguments_hash=arguments_hash,
            approver_did=approver_did,
            policy_version=policy_version,
            issued_at=issued_at,
            completed_at=completed_at,
            agt_version=agt_version,
            agt_policies_version=agt_policies_version,
            cedar_policy_version=cedar_policy_version,
            policy_engine_version=policy_engine_version,
            compatibility_checked_at=compatibility_checked_at,
            compatibility_check_outcome=compatibility_check_outcome,
            escrow_signer_id=escrow_signer_id,
            escrow_key_id=escrow_key_id,
            outcome_hash=outcome_hash,
            escrow_signature=escrow_signature,
            escrow_verification_outcome=escrow_verification_outcome,
            escrow_verified_at=escrow_verified_at,
            summary=summary,
        )

        verification_ingest_request.additional_properties = d
        return verification_ingest_request

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
