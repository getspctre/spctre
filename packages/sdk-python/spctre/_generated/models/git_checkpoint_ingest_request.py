from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.runtime_decision_status import RuntimeDecisionStatus
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.git_checkpoint_ingest_request_agent import (
        GitCheckpointIngestRequestAgent,
    )
    from ..models.git_checkpoint_ingest_request_checkpoint import (
        GitCheckpointIngestRequestCheckpoint,
    )
    from ..models.git_checkpoint_ingest_request_metadata import (
        GitCheckpointIngestRequestMetadata,
    )


T = TypeVar("T", bound="GitCheckpointIngestRequest")


@_attrs_define
class GitCheckpointIngestRequest:
    """Framework-agnostic Git checkpoint and diff evidence. Clients submit normalized Git facts; the server does not
    execute Git or access a caller repository.

        Attributes:
            idempotency_key (str): Stable checkpoint submission key. Reuse it to safely retry.
            environment (str):
            status (RuntimeDecisionStatus):
            reason (str):
            checkpoint (GitCheckpointIngestRequestCheckpoint):
            agent (GitCheckpointIngestRequestAgent | Unset):
            connector (str | Unset): Optional client connector label; defaults to git.
            action (str | Unset): Optional action label; defaults to checkpoint.ingest.
            policy_refs (list[str] | Unset): Caller-supplied references retained as metadata. Policy context is resolved
                server-side.
            metadata (GitCheckpointIngestRequestMetadata | Unset):
    """

    idempotency_key: str
    environment: str
    status: RuntimeDecisionStatus
    reason: str
    checkpoint: GitCheckpointIngestRequestCheckpoint
    agent: GitCheckpointIngestRequestAgent | Unset = UNSET
    connector: str | Unset = UNSET
    action: str | Unset = UNSET
    policy_refs: list[str] | Unset = UNSET
    metadata: GitCheckpointIngestRequestMetadata | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        idempotency_key = self.idempotency_key

        environment = self.environment

        status = self.status.value

        reason = self.reason

        checkpoint = self.checkpoint.to_dict()

        agent: dict[str, Any] | Unset = UNSET
        if not isinstance(self.agent, Unset):
            agent = self.agent.to_dict()

        connector = self.connector

        action = self.action

        policy_refs: list[str] | Unset = UNSET
        if not isinstance(self.policy_refs, Unset):
            policy_refs = self.policy_refs

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "idempotencyKey": idempotency_key,
                "environment": environment,
                "status": status,
                "reason": reason,
                "checkpoint": checkpoint,
            }
        )
        if agent is not UNSET:
            field_dict["agent"] = agent
        if connector is not UNSET:
            field_dict["connector"] = connector
        if action is not UNSET:
            field_dict["action"] = action
        if policy_refs is not UNSET:
            field_dict["policyRefs"] = policy_refs
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.git_checkpoint_ingest_request_agent import (
            GitCheckpointIngestRequestAgent,
        )
        from ..models.git_checkpoint_ingest_request_checkpoint import (
            GitCheckpointIngestRequestCheckpoint,
        )
        from ..models.git_checkpoint_ingest_request_metadata import (
            GitCheckpointIngestRequestMetadata,
        )

        d = dict(src_dict)
        idempotency_key = d.pop("idempotencyKey")

        environment = d.pop("environment")

        status = RuntimeDecisionStatus(d.pop("status"))

        reason = d.pop("reason")

        checkpoint = GitCheckpointIngestRequestCheckpoint.from_dict(d.pop("checkpoint"))

        _agent = d.pop("agent", UNSET)
        agent: GitCheckpointIngestRequestAgent | Unset
        if isinstance(_agent, Unset):
            agent = UNSET
        else:
            agent = GitCheckpointIngestRequestAgent.from_dict(_agent)

        connector = d.pop("connector", UNSET)

        action = d.pop("action", UNSET)

        policy_refs = cast(list[str], d.pop("policyRefs", UNSET))

        _metadata = d.pop("metadata", UNSET)
        metadata: GitCheckpointIngestRequestMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = GitCheckpointIngestRequestMetadata.from_dict(_metadata)

        git_checkpoint_ingest_request = cls(
            idempotency_key=idempotency_key,
            environment=environment,
            status=status,
            reason=reason,
            checkpoint=checkpoint,
            agent=agent,
            connector=connector,
            action=action,
            policy_refs=policy_refs,
            metadata=metadata,
        )

        git_checkpoint_ingest_request.additional_properties = d
        return git_checkpoint_ingest_request

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
