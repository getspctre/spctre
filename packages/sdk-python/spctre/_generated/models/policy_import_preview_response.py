from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.policy_import_preview_response_source_format import (
    PolicyImportPreviewResponseSourceFormat,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.api_meta import ApiMeta
    from ..models.policy_import_preview_response_diagnostics_item import (
        PolicyImportPreviewResponseDiagnosticsItem,
    )
    from ..models.policy_import_preview_response_rules_item import (
        PolicyImportPreviewResponseRulesItem,
    )
    from ..models.policy_import_preview_response_source_document import (
        PolicyImportPreviewResponseSourceDocument,
    )
    from ..models.policy_import_preview_response_translation import (
        PolicyImportPreviewResponseTranslation,
    )


T = TypeVar("T", bound="PolicyImportPreviewResponse")


@_attrs_define
class PolicyImportPreviewResponse:
    """
    Attributes:
        dry_run (bool):
        source_format (PolicyImportPreviewResponseSourceFormat):
        source_hash (str):
        rule_count (int):
        rules (list[PolicyImportPreviewResponseRulesItem]):
        diagnostics (list[PolicyImportPreviewResponseDiagnosticsItem]):
        warnings (list[str]):
        meta (ApiMeta):
        source_document (PolicyImportPreviewResponseSourceDocument | Unset):
        translation (PolicyImportPreviewResponseTranslation | Unset):
    """

    dry_run: bool
    source_format: PolicyImportPreviewResponseSourceFormat
    source_hash: str
    rule_count: int
    rules: list[PolicyImportPreviewResponseRulesItem]
    diagnostics: list[PolicyImportPreviewResponseDiagnosticsItem]
    warnings: list[str]
    meta: ApiMeta
    source_document: PolicyImportPreviewResponseSourceDocument | Unset = UNSET
    translation: PolicyImportPreviewResponseTranslation | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        dry_run = self.dry_run

        source_format = self.source_format.value

        source_hash = self.source_hash

        rule_count = self.rule_count

        rules = []
        for rules_item_data in self.rules:
            rules_item = rules_item_data.to_dict()
            rules.append(rules_item)

        diagnostics = []
        for diagnostics_item_data in self.diagnostics:
            diagnostics_item = diagnostics_item_data.to_dict()
            diagnostics.append(diagnostics_item)

        warnings = self.warnings

        meta = self.meta.to_dict()

        source_document: dict[str, Any] | Unset = UNSET
        if not isinstance(self.source_document, Unset):
            source_document = self.source_document.to_dict()

        translation: dict[str, Any] | Unset = UNSET
        if not isinstance(self.translation, Unset):
            translation = self.translation.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "dryRun": dry_run,
                "sourceFormat": source_format,
                "sourceHash": source_hash,
                "ruleCount": rule_count,
                "rules": rules,
                "diagnostics": diagnostics,
                "warnings": warnings,
                "meta": meta,
            }
        )
        if source_document is not UNSET:
            field_dict["sourceDocument"] = source_document
        if translation is not UNSET:
            field_dict["translation"] = translation

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_meta import ApiMeta
        from ..models.policy_import_preview_response_diagnostics_item import (
            PolicyImportPreviewResponseDiagnosticsItem,
        )
        from ..models.policy_import_preview_response_rules_item import (
            PolicyImportPreviewResponseRulesItem,
        )
        from ..models.policy_import_preview_response_source_document import (
            PolicyImportPreviewResponseSourceDocument,
        )
        from ..models.policy_import_preview_response_translation import (
            PolicyImportPreviewResponseTranslation,
        )

        d = dict(src_dict)
        dry_run = d.pop("dryRun")

        source_format = PolicyImportPreviewResponseSourceFormat(d.pop("sourceFormat"))

        source_hash = d.pop("sourceHash")

        rule_count = d.pop("ruleCount")

        rules = []
        _rules = d.pop("rules")
        for rules_item_data in _rules:
            rules_item = PolicyImportPreviewResponseRulesItem.from_dict(rules_item_data)

            rules.append(rules_item)

        diagnostics = []
        _diagnostics = d.pop("diagnostics")
        for diagnostics_item_data in _diagnostics:
            diagnostics_item = PolicyImportPreviewResponseDiagnosticsItem.from_dict(
                diagnostics_item_data
            )

            diagnostics.append(diagnostics_item)

        warnings = cast(list[str], d.pop("warnings"))

        meta = ApiMeta.from_dict(d.pop("meta"))

        _source_document = d.pop("sourceDocument", UNSET)
        source_document: PolicyImportPreviewResponseSourceDocument | Unset
        if isinstance(_source_document, Unset):
            source_document = UNSET
        else:
            source_document = PolicyImportPreviewResponseSourceDocument.from_dict(
                _source_document
            )

        _translation = d.pop("translation", UNSET)
        translation: PolicyImportPreviewResponseTranslation | Unset
        if isinstance(_translation, Unset):
            translation = UNSET
        else:
            translation = PolicyImportPreviewResponseTranslation.from_dict(_translation)

        policy_import_preview_response = cls(
            dry_run=dry_run,
            source_format=source_format,
            source_hash=source_hash,
            rule_count=rule_count,
            rules=rules,
            diagnostics=diagnostics,
            warnings=warnings,
            meta=meta,
            source_document=source_document,
            translation=translation,
        )

        policy_import_preview_response.additional_properties = d
        return policy_import_preview_response

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
