from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.compliance_export_response import ComplianceExportResponse
from ...models.export_compliance_format import ExportComplianceFormat
from ...models.export_compliance_framework import ExportComplianceFramework
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    framework: ExportComplianceFramework | Unset = UNSET,
    format_: ExportComplianceFormat | Unset = ExportComplianceFormat.JSON,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_framework: str | Unset = UNSET
    if not isinstance(framework, Unset):
        json_framework = framework.value

    params["framework"] = json_framework

    json_format_: str | Unset = UNSET
    if not isinstance(format_, Unset):
        json_format_ = format_.value

    params["format"] = json_format_

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/compliance/export",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | ComplianceExportResponse | None:
    if response.status_code == 200:
        response_200 = ComplianceExportResponse.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = ApiError.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = ApiError.from_dict(response.json())

        return response_404

    if response.status_code == 503:
        response_503 = ApiError.from_dict(response.json())

        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ApiError | ComplianceExportResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    framework: ExportComplianceFramework | Unset = UNSET,
    format_: ExportComplianceFormat | Unset = ExportComplianceFormat.JSON,
) -> Response[ApiError | ComplianceExportResponse]:
    """Export the compliance packet

     Generates and returns the latest compliance packet for the workspace as a JSON attachment.
    Optionally annotated for a specific framework (`soc2`, `iso27001`, `hipaa`, `gdpr`, `pci-dss`,
    `nist-ai-rmf`, `public-sector`, `eu-ai-act`).

    Args:
        framework (ExportComplianceFramework | Unset):
        format_ (ExportComplianceFormat | Unset):  Default: ExportComplianceFormat.JSON.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | ComplianceExportResponse]
    """

    kwargs = _get_kwargs(
        framework=framework,
        format_=format_,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    framework: ExportComplianceFramework | Unset = UNSET,
    format_: ExportComplianceFormat | Unset = ExportComplianceFormat.JSON,
) -> ApiError | ComplianceExportResponse | None:
    """Export the compliance packet

     Generates and returns the latest compliance packet for the workspace as a JSON attachment.
    Optionally annotated for a specific framework (`soc2`, `iso27001`, `hipaa`, `gdpr`, `pci-dss`,
    `nist-ai-rmf`, `public-sector`, `eu-ai-act`).

    Args:
        framework (ExportComplianceFramework | Unset):
        format_ (ExportComplianceFormat | Unset):  Default: ExportComplianceFormat.JSON.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | ComplianceExportResponse
    """

    return sync_detailed(
        client=client,
        framework=framework,
        format_=format_,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    framework: ExportComplianceFramework | Unset = UNSET,
    format_: ExportComplianceFormat | Unset = ExportComplianceFormat.JSON,
) -> Response[ApiError | ComplianceExportResponse]:
    """Export the compliance packet

     Generates and returns the latest compliance packet for the workspace as a JSON attachment.
    Optionally annotated for a specific framework (`soc2`, `iso27001`, `hipaa`, `gdpr`, `pci-dss`,
    `nist-ai-rmf`, `public-sector`, `eu-ai-act`).

    Args:
        framework (ExportComplianceFramework | Unset):
        format_ (ExportComplianceFormat | Unset):  Default: ExportComplianceFormat.JSON.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | ComplianceExportResponse]
    """

    kwargs = _get_kwargs(
        framework=framework,
        format_=format_,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    framework: ExportComplianceFramework | Unset = UNSET,
    format_: ExportComplianceFormat | Unset = ExportComplianceFormat.JSON,
) -> ApiError | ComplianceExportResponse | None:
    """Export the compliance packet

     Generates and returns the latest compliance packet for the workspace as a JSON attachment.
    Optionally annotated for a specific framework (`soc2`, `iso27001`, `hipaa`, `gdpr`, `pci-dss`,
    `nist-ai-rmf`, `public-sector`, `eu-ai-act`).

    Args:
        framework (ExportComplianceFramework | Unset):
        format_ (ExportComplianceFormat | Unset):  Default: ExportComplianceFormat.JSON.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | ComplianceExportResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            framework=framework,
            format_=format_,
        )
    ).parsed
