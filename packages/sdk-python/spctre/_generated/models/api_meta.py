from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="ApiMeta")


@_attrs_define
class ApiMeta:
    """
    Attributes:
        trace_id (str): Correlation ID echoed from X-Request-ID or generated server-side.
        version (str): API version string.
        ts (datetime.datetime): ISO timestamp of the response.
    """

    trace_id: str
    version: str
    ts: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        trace_id = self.trace_id

        version = self.version

        ts = self.ts.isoformat()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "traceId": trace_id,
                "version": version,
                "ts": ts,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        trace_id = d.pop("traceId")

        version = d.pop("version")

        ts = datetime.datetime.fromisoformat(d.pop("ts"))

        api_meta = cls(
            trace_id=trace_id,
            version=version,
            ts=ts,
        )

        api_meta.additional_properties = d
        return api_meta

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
