from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.api_meta import ApiMeta


T = TypeVar("T", bound="TokenRefreshResponse")


@_attrs_define
class TokenRefreshResponse:
    """
    Attributes:
        access_token (str):
        access_token_expires_at (datetime.datetime):
        refresh_token (str):
        refresh_token_expires_at (datetime.datetime):
        meta (ApiMeta):
    """

    access_token: str
    access_token_expires_at: datetime.datetime
    refresh_token: str
    refresh_token_expires_at: datetime.datetime
    meta: ApiMeta
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        access_token = self.access_token

        access_token_expires_at = self.access_token_expires_at.isoformat()

        refresh_token = self.refresh_token

        refresh_token_expires_at = self.refresh_token_expires_at.isoformat()

        meta = self.meta.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "accessToken": access_token,
                "accessTokenExpiresAt": access_token_expires_at,
                "refreshToken": refresh_token,
                "refreshTokenExpiresAt": refresh_token_expires_at,
                "meta": meta,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.api_meta import ApiMeta

        d = dict(src_dict)
        access_token = d.pop("accessToken")

        access_token_expires_at = datetime.datetime.fromisoformat(
            d.pop("accessTokenExpiresAt")
        )

        refresh_token = d.pop("refreshToken")

        refresh_token_expires_at = datetime.datetime.fromisoformat(
            d.pop("refreshTokenExpiresAt")
        )

        meta = ApiMeta.from_dict(d.pop("meta"))

        token_refresh_response = cls(
            access_token=access_token,
            access_token_expires_at=access_token_expires_at,
            refresh_token=refresh_token,
            refresh_token_expires_at=refresh_token_expires_at,
            meta=meta,
        )

        token_refresh_response.additional_properties = d
        return token_refresh_response

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
