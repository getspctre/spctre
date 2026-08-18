from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.policy_import_preview_response import PolicyImportPreviewResponse
from ...models.policy_import_request import PolicyImportRequest
from ...models.policy_import_response import PolicyImportResponse
from ...types import Response


def _get_kwargs(
    *,
    body: PolicyImportRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/policy/imports",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | PolicyImportPreviewResponse | PolicyImportResponse | None:
    if response.status_code == 200:

        def _parse_response_200(
            data: object,
        ) -> PolicyImportPreviewResponse | PolicyImportResponse:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_200_type_0 = PolicyImportResponse.from_dict(data)

                return response_200_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            response_200_type_1 = PolicyImportPreviewResponse.from_dict(data)

            return response_200_type_1

        response_200 = _parse_response_200(response.json())

        return response_200

    if response.status_code == 201:
        response_201 = PolicyImportResponse.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = ApiError.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ApiError.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = ApiError.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ApiError | PolicyImportPreviewResponse | PolicyImportResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: PolicyImportRequest,
) -> Response[ApiError | PolicyImportPreviewResponse | PolicyImportResponse]:
    """Import a local policy source (idempotent)

     Imports a local policy source into the control plane as an unapproved draft branch/revision, for
    automation/CI. AGT YAML/JSON is accepted directly; the documented Rego and Cedar subsets are
    translated to AGT-compatible rules before validation. Requires the `policy:import` scope, which is
    admin-issuable only and never granted to runtime agent tokens. `dryRun: true` returns conversion
    diagnostics without writing. Never approves or publishes — review and publication remain manual.

    Args:
        body (PolicyImportRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | PolicyImportPreviewResponse | PolicyImportResponse | PolicyImportResponse]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: PolicyImportRequest,
) -> ApiError | PolicyImportPreviewResponse | PolicyImportResponse | None:
    """Import a local policy source (idempotent)

     Imports a local policy source into the control plane as an unapproved draft branch/revision, for
    automation/CI. AGT YAML/JSON is accepted directly; the documented Rego and Cedar subsets are
    translated to AGT-compatible rules before validation. Requires the `policy:import` scope, which is
    admin-issuable only and never granted to runtime agent tokens. `dryRun: true` returns conversion
    diagnostics without writing. Never approves or publishes — review and publication remain manual.

    Args:
        body (PolicyImportRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | PolicyImportPreviewResponse | PolicyImportResponse | PolicyImportResponse
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PolicyImportRequest,
) -> Response[ApiError | PolicyImportPreviewResponse | PolicyImportResponse]:
    """Import a local policy source (idempotent)

     Imports a local policy source into the control plane as an unapproved draft branch/revision, for
    automation/CI. AGT YAML/JSON is accepted directly; the documented Rego and Cedar subsets are
    translated to AGT-compatible rules before validation. Requires the `policy:import` scope, which is
    admin-issuable only and never granted to runtime agent tokens. `dryRun: true` returns conversion
    diagnostics without writing. Never approves or publishes — review and publication remain manual.

    Args:
        body (PolicyImportRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | PolicyImportPreviewResponse | PolicyImportResponse | PolicyImportResponse]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PolicyImportRequest,
) -> ApiError | PolicyImportPreviewResponse | PolicyImportResponse | None:
    """Import a local policy source (idempotent)

     Imports a local policy source into the control plane as an unapproved draft branch/revision, for
    automation/CI. AGT YAML/JSON is accepted directly; the documented Rego and Cedar subsets are
    translated to AGT-compatible rules before validation. Requires the `policy:import` scope, which is
    admin-issuable only and never granted to runtime agent tokens. `dryRun: true` returns conversion
    diagnostics without writing. Never approves or publishes — review and publication remain manual.

    Args:
        body (PolicyImportRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | PolicyImportPreviewResponse | PolicyImportResponse | PolicyImportResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
