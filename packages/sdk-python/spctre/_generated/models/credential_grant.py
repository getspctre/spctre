from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="CredentialGrant")


@_attrs_define
class CredentialGrant:
    """
    Attributes:
        credential_type (str):
        injected_parameter (str):
        credential_value (str):
        expires_at (datetime.datetime):
    """

    credential_type: str
    injected_parameter: str
    credential_value: str
    expires_at: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        credential_type = self.credential_type

        injected_parameter = self.injected_parameter

        credential_value = self.credential_value

        expires_at = self.expires_at.isoformat()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "credentialType": credential_type,
                "injectedParameter": injected_parameter,
                "credentialValue": credential_value,
                "expiresAt": expires_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        credential_type = d.pop("credentialType")

        injected_parameter = d.pop("injectedParameter")

        credential_value = d.pop("credentialValue")

        expires_at = datetime.datetime.fromisoformat(d.pop("expiresAt"))

        credential_grant = cls(
            credential_type=credential_type,
            injected_parameter=injected_parameter,
            credential_value=credential_value,
            expires_at=expires_at,
        )

        credential_grant.additional_properties = d
        return credential_grant

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
