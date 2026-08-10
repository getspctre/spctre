from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="EvidenceIngestRequestExecutionContext")


@_attrs_define
class EvidenceIngestRequestExecutionContext:
    """Execution surface identity plus sandbox/inference-router evidence references.

    Attributes:
        backend (str | Unset):
        session_id (str | Unset):
        sandbox_name (str | Unset):
        inference_provider (str | Unset):
        sandbox_policy_ref (str | Unset):
        inference_router_ref (str | Unset):
    """

    backend: str | Unset = UNSET
    session_id: str | Unset = UNSET
    sandbox_name: str | Unset = UNSET
    inference_provider: str | Unset = UNSET
    sandbox_policy_ref: str | Unset = UNSET
    inference_router_ref: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        backend = self.backend

        session_id = self.session_id

        sandbox_name = self.sandbox_name

        inference_provider = self.inference_provider

        sandbox_policy_ref = self.sandbox_policy_ref

        inference_router_ref = self.inference_router_ref

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if backend is not UNSET:
            field_dict["backend"] = backend
        if session_id is not UNSET:
            field_dict["sessionId"] = session_id
        if sandbox_name is not UNSET:
            field_dict["sandboxName"] = sandbox_name
        if inference_provider is not UNSET:
            field_dict["inferenceProvider"] = inference_provider
        if sandbox_policy_ref is not UNSET:
            field_dict["sandboxPolicyRef"] = sandbox_policy_ref
        if inference_router_ref is not UNSET:
            field_dict["inferenceRouterRef"] = inference_router_ref

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        backend = d.pop("backend", UNSET)

        session_id = d.pop("sessionId", UNSET)

        sandbox_name = d.pop("sandboxName", UNSET)

        inference_provider = d.pop("inferenceProvider", UNSET)

        sandbox_policy_ref = d.pop("sandboxPolicyRef", UNSET)

        inference_router_ref = d.pop("inferenceRouterRef", UNSET)

        evidence_ingest_request_execution_context = cls(
            backend=backend,
            session_id=session_id,
            sandbox_name=sandbox_name,
            inference_provider=inference_provider,
            sandbox_policy_ref=sandbox_policy_ref,
            inference_router_ref=inference_router_ref,
        )

        evidence_ingest_request_execution_context.additional_properties = d
        return evidence_ingest_request_execution_context

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
