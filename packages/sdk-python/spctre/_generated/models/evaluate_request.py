from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.evaluate_request_tool_parameters import EvaluateRequestToolParameters


T = TypeVar("T", bound="EvaluateRequest")


@_attrs_define
class EvaluateRequest:
    """
    Attributes:
        connector (str):
        action (str):
        domains (list[str] | Unset): Optional domain tags used for additional policy matching.
        tool_intent (str | Unset): The explicitly declared intent or purpose of the tool call.
        plan_summary (str | Unset): A high-level plan summary explicitly provided by the runtime.
        tool_parameters (EvaluateRequestToolParameters | Unset): The structured arguments passed to the tool.
    """

    connector: str
    action: str
    domains: list[str] | Unset = UNSET
    tool_intent: str | Unset = UNSET
    plan_summary: str | Unset = UNSET
    tool_parameters: EvaluateRequestToolParameters | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        connector = self.connector

        action = self.action

        domains: list[str] | Unset = UNSET
        if not isinstance(self.domains, Unset):
            domains = self.domains

        tool_intent = self.tool_intent

        plan_summary = self.plan_summary

        tool_parameters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.tool_parameters, Unset):
            tool_parameters = self.tool_parameters.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "connector": connector,
                "action": action,
            }
        )
        if domains is not UNSET:
            field_dict["domains"] = domains
        if tool_intent is not UNSET:
            field_dict["toolIntent"] = tool_intent
        if plan_summary is not UNSET:
            field_dict["planSummary"] = plan_summary
        if tool_parameters is not UNSET:
            field_dict["toolParameters"] = tool_parameters

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.evaluate_request_tool_parameters import (
            EvaluateRequestToolParameters,
        )

        d = dict(src_dict)
        connector = d.pop("connector")

        action = d.pop("action")

        domains = cast(list[str], d.pop("domains", UNSET))

        tool_intent = d.pop("toolIntent", UNSET)

        plan_summary = d.pop("planSummary", UNSET)

        _tool_parameters = d.pop("toolParameters", UNSET)
        tool_parameters: EvaluateRequestToolParameters | Unset
        if isinstance(_tool_parameters, Unset):
            tool_parameters = UNSET
        else:
            tool_parameters = EvaluateRequestToolParameters.from_dict(_tool_parameters)

        evaluate_request = cls(
            connector=connector,
            action=action,
            domains=domains,
            tool_intent=tool_intent,
            plan_summary=plan_summary,
            tool_parameters=tool_parameters,
        )

        evaluate_request.additional_properties = d
        return evaluate_request

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
