from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.policy_import_request_scope import PolicyImportRequestScope
from ..models.policy_import_request_source_format import PolicyImportRequestSourceFormat
from ..types import UNSET, Unset

T = TypeVar("T", bound="PolicyImportRequest")


@_attrs_define
class PolicyImportRequest:
    """
    Attributes:
        source (str): Policy source. AGT YAML/JSON is accepted directly; the documented Rego and Cedar subsets are
            translated into AGT-compatible rules before review.
        branch_name (str): Target branch name. Lowercase letters, digits, hyphens, and slashes; cannot start or end with
            a hyphen or slash.
        source_format (PolicyImportRequestSourceFormat | Unset): Optional source dialect. The server otherwise detects
            .rego/.cedar paths and recognizable native syntax.
        dry_run (bool | Unset): Validate and translate without creating a branch or revision.
        accept_lossy (bool | Unset): Required to persist a conversion that reports semantic loss. Dry runs always report
            loss without persisting.
        scope (PolicyImportRequestScope | Unset): Branch scope. Optional; the server defaults to WORKSPACE when omitted.
        connector (str | Unset): Connector id. Required when scope is CONNECTOR.
        environment (str | Unset): Environment. Required when scope is ENVIRONMENT.
        source_path (str | Unset): Provenance path recorded with the revision.
        target_stacks (list[str] | Unset): Optional AGT-compatible export target stacks recorded with the revision.
    """

    source: str
    branch_name: str
    source_format: PolicyImportRequestSourceFormat | Unset = UNSET
    dry_run: bool | Unset = UNSET
    accept_lossy: bool | Unset = UNSET
    scope: PolicyImportRequestScope | Unset = UNSET
    connector: str | Unset = UNSET
    environment: str | Unset = UNSET
    source_path: str | Unset = UNSET
    target_stacks: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        source = self.source

        branch_name = self.branch_name

        source_format: str | Unset = UNSET
        if not isinstance(self.source_format, Unset):
            source_format = self.source_format.value

        dry_run = self.dry_run

        accept_lossy = self.accept_lossy

        scope: str | Unset = UNSET
        if not isinstance(self.scope, Unset):
            scope = self.scope.value

        connector = self.connector

        environment = self.environment

        source_path = self.source_path

        target_stacks: list[str] | Unset = UNSET
        if not isinstance(self.target_stacks, Unset):
            target_stacks = self.target_stacks

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "source": source,
                "branchName": branch_name,
            }
        )
        if source_format is not UNSET:
            field_dict["sourceFormat"] = source_format
        if dry_run is not UNSET:
            field_dict["dryRun"] = dry_run
        if accept_lossy is not UNSET:
            field_dict["acceptLossy"] = accept_lossy
        if scope is not UNSET:
            field_dict["scope"] = scope
        if connector is not UNSET:
            field_dict["connector"] = connector
        if environment is not UNSET:
            field_dict["environment"] = environment
        if source_path is not UNSET:
            field_dict["sourcePath"] = source_path
        if target_stacks is not UNSET:
            field_dict["targetStacks"] = target_stacks

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        source = d.pop("source")

        branch_name = d.pop("branchName")

        _source_format = d.pop("sourceFormat", UNSET)
        source_format: PolicyImportRequestSourceFormat | Unset
        if isinstance(_source_format, Unset):
            source_format = UNSET
        else:
            source_format = PolicyImportRequestSourceFormat(_source_format)

        dry_run = d.pop("dryRun", UNSET)

        accept_lossy = d.pop("acceptLossy", UNSET)

        _scope = d.pop("scope", UNSET)
        scope: PolicyImportRequestScope | Unset
        if isinstance(_scope, Unset):
            scope = UNSET
        else:
            scope = PolicyImportRequestScope(_scope)

        connector = d.pop("connector", UNSET)

        environment = d.pop("environment", UNSET)

        source_path = d.pop("sourcePath", UNSET)

        target_stacks = cast(list[str], d.pop("targetStacks", UNSET))

        policy_import_request = cls(
            source=source,
            branch_name=branch_name,
            source_format=source_format,
            dry_run=dry_run,
            accept_lossy=accept_lossy,
            scope=scope,
            connector=connector,
            environment=environment,
            source_path=source_path,
            target_stacks=target_stacks,
        )

        policy_import_request.additional_properties = d
        return policy_import_request

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
