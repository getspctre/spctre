from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.runtime_stack import RuntimeStack
from ..models.trust_score_ingest_request_source import TrustScoreIngestRequestSource
from ..types import UNSET, Unset

T = TypeVar("T", bound="TrustScoreIngestRequest")


@_attrs_define
class TrustScoreIngestRequest:
    """
    Attributes:
        agent_id (str):
        environment (str):
        runtime_stack (RuntimeStack):
        trust_score (float):
        source (TrustScoreIngestRequestSource):
        source_ref (str | Unset):
        reason (str | Unset):
    """

    agent_id: str
    environment: str
    runtime_stack: RuntimeStack
    trust_score: float
    source: TrustScoreIngestRequestSource
    source_ref: str | Unset = UNSET
    reason: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        agent_id = self.agent_id

        environment = self.environment

        runtime_stack = self.runtime_stack.value

        trust_score = self.trust_score

        source = self.source.value

        source_ref = self.source_ref

        reason = self.reason

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "agentId": agent_id,
                "environment": environment,
                "runtimeStack": runtime_stack,
                "trustScore": trust_score,
                "source": source,
            }
        )
        if source_ref is not UNSET:
            field_dict["sourceRef"] = source_ref
        if reason is not UNSET:
            field_dict["reason"] = reason

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        agent_id = d.pop("agentId")

        environment = d.pop("environment")

        runtime_stack = RuntimeStack(d.pop("runtimeStack"))

        trust_score = d.pop("trustScore")

        source = TrustScoreIngestRequestSource(d.pop("source"))

        source_ref = d.pop("sourceRef", UNSET)

        reason = d.pop("reason", UNSET)

        trust_score_ingest_request = cls(
            agent_id=agent_id,
            environment=environment,
            runtime_stack=runtime_stack,
            trust_score=trust_score,
            source=source,
            source_ref=source_ref,
            reason=reason,
        )

        trust_score_ingest_request.additional_properties = d
        return trust_score_ingest_request

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
