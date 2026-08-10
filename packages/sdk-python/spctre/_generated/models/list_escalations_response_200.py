from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.api_meta import ApiMeta
    from ..models.escalation_queue_item import EscalationQueueItem
    from ..models.pagination import Pagination


T = TypeVar("T", bound="ListEscalationsResponse200")


@_attrs_define
class ListEscalationsResponse200:
    """
    Attributes:
        queue (list[EscalationQueueItem] | Unset):
        count (int | Unset):
        generated_at (datetime.datetime | Unset):
        pagination (Pagination | Unset):
        meta (ApiMeta | Unset):
    """

    queue: list[EscalationQueueItem] | Unset = UNSET
    count: int | Unset = UNSET
    generated_at: datetime.datetime | Unset = UNSET
    pagination: Pagination | Unset = UNSET
    meta: ApiMeta | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        queue: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.queue, Unset):
            queue = []
            for queue_item_data in self.queue:
                queue_item = queue_item_data.to_dict()
                queue.append(queue_item)

        count = self.count

        generated_at: str | Unset = UNSET
        if not isinstance(self.generated_at, Unset):
            generated_at = self.generated_at.isoformat()

        pagination: dict[str, Any] | Unset = UNSET
        if not isinstance(self.pagination, Unset):
            pagination = self.pagination.to_dict()

        meta: dict[str, Any] | Unset = UNSET
        if not isinstance(self.meta, Unset):
            meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if queue is not UNSET:
            field_dict["queue"] = queue
        if count is not UNSET:
            field_dict["count"] = count
        if generated_at is not UNSET:
            field_dict["generatedAt"] = generated_at
        if pagination is not UNSET:
            field_dict["pagination"] = pagination
        if meta is not UNSET:
            field_dict["meta"] = meta

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_meta import ApiMeta
        from ..models.escalation_queue_item import EscalationQueueItem
        from ..models.pagination import Pagination

        d = dict(src_dict)
        _queue = d.pop("queue", UNSET)
        queue: list[EscalationQueueItem] | Unset = UNSET
        if _queue is not UNSET:
            queue = []
            for queue_item_data in _queue:
                queue_item = EscalationQueueItem.from_dict(queue_item_data)

                queue.append(queue_item)

        count = d.pop("count", UNSET)

        _generated_at = d.pop("generatedAt", UNSET)
        generated_at: datetime.datetime | Unset
        if isinstance(_generated_at, Unset):
            generated_at = UNSET
        else:
            generated_at = datetime.datetime.fromisoformat(_generated_at)

        _pagination = d.pop("pagination", UNSET)
        pagination: Pagination | Unset
        if isinstance(_pagination, Unset):
            pagination = UNSET
        else:
            pagination = Pagination.from_dict(_pagination)

        _meta = d.pop("meta", UNSET)
        meta: ApiMeta | Unset
        if isinstance(_meta, Unset):
            meta = UNSET
        else:
            meta = ApiMeta.from_dict(_meta)

        list_escalations_response_200 = cls(
            queue=queue,
            count=count,
            generated_at=generated_at,
            pagination=pagination,
            meta=meta,
        )

        list_escalations_response_200.additional_properties = d
        return list_escalations_response_200

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
