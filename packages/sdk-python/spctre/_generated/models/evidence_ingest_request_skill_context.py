from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="EvidenceIngestRequestSkillContext")


@_attrs_define
class EvidenceIngestRequestSkillContext:
    """Prompt-level governance surface: active skills, instruction files, and prompt policy refs present when the decision
    was made.

        Attributes:
            active_skills (list[str] | Unset):
            instruction_files (list[str] | Unset):
            prompt_policy_refs (list[str] | Unset):
            prompt_surface (str | Unset):
    """

    active_skills: list[str] | Unset = UNSET
    instruction_files: list[str] | Unset = UNSET
    prompt_policy_refs: list[str] | Unset = UNSET
    prompt_surface: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        active_skills: list[str] | Unset = UNSET
        if not isinstance(self.active_skills, Unset):
            active_skills = self.active_skills

        instruction_files: list[str] | Unset = UNSET
        if not isinstance(self.instruction_files, Unset):
            instruction_files = self.instruction_files

        prompt_policy_refs: list[str] | Unset = UNSET
        if not isinstance(self.prompt_policy_refs, Unset):
            prompt_policy_refs = self.prompt_policy_refs

        prompt_surface = self.prompt_surface

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if active_skills is not UNSET:
            field_dict["activeSkills"] = active_skills
        if instruction_files is not UNSET:
            field_dict["instructionFiles"] = instruction_files
        if prompt_policy_refs is not UNSET:
            field_dict["promptPolicyRefs"] = prompt_policy_refs
        if prompt_surface is not UNSET:
            field_dict["promptSurface"] = prompt_surface

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        active_skills = cast(list[str], d.pop("activeSkills", UNSET))

        instruction_files = cast(list[str], d.pop("instructionFiles", UNSET))

        prompt_policy_refs = cast(list[str], d.pop("promptPolicyRefs", UNSET))

        prompt_surface = d.pop("promptSurface", UNSET)

        evidence_ingest_request_skill_context = cls(
            active_skills=active_skills,
            instruction_files=instruction_files,
            prompt_policy_refs=prompt_policy_refs,
            prompt_surface=prompt_surface,
        )

        evidence_ingest_request_skill_context.additional_properties = d
        return evidence_ingest_request_skill_context

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
