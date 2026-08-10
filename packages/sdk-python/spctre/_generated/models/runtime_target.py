from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.runtime_stack import RuntimeStack
from ..types import UNSET, Unset

T = TypeVar("T", bound="RuntimeTarget")


@_attrs_define
class RuntimeTarget:
    """
    Attributes:
        stack (RuntimeStack):
        adapter (str | Unset): Specific adapter within the stack.
        environment (str | Unset):
        sandbox_name (str | Unset): Runtime sandbox/deployment name for sandbox-layer policy and evidence queries.
        inference_provider (str | Unset): Inference router/provider identifier for model-routing policy and evidence
            queries.
    """

    stack: RuntimeStack
    adapter: str | Unset = UNSET
    environment: str | Unset = UNSET
    sandbox_name: str | Unset = UNSET
    inference_provider: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        stack = self.stack.value

        adapter = self.adapter

        environment = self.environment

        sandbox_name = self.sandbox_name

        inference_provider = self.inference_provider

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "stack": stack,
            }
        )
        if adapter is not UNSET:
            field_dict["adapter"] = adapter
        if environment is not UNSET:
            field_dict["environment"] = environment
        if sandbox_name is not UNSET:
            field_dict["sandboxName"] = sandbox_name
        if inference_provider is not UNSET:
            field_dict["inferenceProvider"] = inference_provider

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        stack = RuntimeStack(d.pop("stack"))

        adapter = d.pop("adapter", UNSET)

        environment = d.pop("environment", UNSET)

        sandbox_name = d.pop("sandboxName", UNSET)

        inference_provider = d.pop("inferenceProvider", UNSET)

        runtime_target = cls(
            stack=stack,
            adapter=adapter,
            environment=environment,
            sandbox_name=sandbox_name,
            inference_provider=inference_provider,
        )

        runtime_target.additional_properties = d
        return runtime_target

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
