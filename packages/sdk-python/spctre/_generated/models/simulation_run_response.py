from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.api_meta import ApiMeta


T = TypeVar("T", bound="SimulationRunResponse")


@_attrs_define
class SimulationRunResponse:
    """
    Attributes:
        run_id (str): Identifier of the recorded simulation run.
        branch_id (str):
        revision_id (str):
        total (int): Evidence events replayed.
        newly_denied (int): Events the revision would deny that the published policy allowed.
        newly_allowed (int): Events the revision would allow that the published policy denied.
        unchanged (int): Events whose outcome does not change.
        meta (ApiMeta):
    """

    run_id: str
    branch_id: str
    revision_id: str
    total: int
    newly_denied: int
    newly_allowed: int
    unchanged: int
    meta: ApiMeta
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        run_id = self.run_id

        branch_id = self.branch_id

        revision_id = self.revision_id

        total = self.total

        newly_denied = self.newly_denied

        newly_allowed = self.newly_allowed

        unchanged = self.unchanged

        meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "runId": run_id,
                "branchId": branch_id,
                "revisionId": revision_id,
                "total": total,
                "newlyDenied": newly_denied,
                "newlyAllowed": newly_allowed,
                "unchanged": unchanged,
                "meta": meta,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_meta import ApiMeta

        d = dict(src_dict)
        run_id = d.pop("runId")

        branch_id = d.pop("branchId")

        revision_id = d.pop("revisionId")

        total = d.pop("total")

        newly_denied = d.pop("newlyDenied")

        newly_allowed = d.pop("newlyAllowed")

        unchanged = d.pop("unchanged")

        meta = ApiMeta.from_dict(d.pop("meta"))

        simulation_run_response = cls(
            run_id=run_id,
            branch_id=branch_id,
            revision_id=revision_id,
            total=total,
            newly_denied=newly_denied,
            newly_allowed=newly_allowed,
            unchanged=unchanged,
            meta=meta,
        )

        simulation_run_response.additional_properties = d
        return simulation_run_response

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
