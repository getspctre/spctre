from http import HTTPStatus
from typing import Any, cast
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.ingest_otlp_logs_body import IngestOtlpLogsBody
from ...types import Response


def _get_kwargs(
    *,
    body: IngestOtlpLogsBody,
    x_spctre_integration_id: UUID,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    headers["x-spctre-integration-id"] = x_spctre_integration_id

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/logs",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | ApiError | None:
    if response.status_code == 200:
        response_200 = cast(Any, None)
        return response_200

    if response.status_code == 201:
        response_201 = cast(Any, None)
        return response_201

    if response.status_code == 207:
        response_207 = cast(Any, None)
        return response_207

    if response.status_code == 400:
        response_400 = ApiError.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ApiError.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = ApiError.from_dict(response.json())

        return response_404

    if response.status_code == 413:
        response_413 = cast(Any, None)
        return response_413

    if response.status_code == 415:
        response_415 = cast(Any, None)
        return response_415

    if response.status_code == 429:
        response_429 = cast(Any, None)
        return response_429

    if response.status_code == 503:
        response_503 = ApiError.from_dict(response.json())

        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | ApiError]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: IngestOtlpLogsBody,
    x_spctre_integration_id: UUID,
) -> Response[Any | ApiError]:
    """Ingest OTLP/HTTP JSON log records

    Args:
        x_spctre_integration_id (UUID):
        body (IngestOtlpLogsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ApiError]
    """

    kwargs = _get_kwargs(
        body=body,
        x_spctre_integration_id=x_spctre_integration_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: IngestOtlpLogsBody,
    x_spctre_integration_id: UUID,
) -> Any | ApiError | None:
    """Ingest OTLP/HTTP JSON log records

    Args:
        x_spctre_integration_id (UUID):
        body (IngestOtlpLogsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ApiError
    """

    return sync_detailed(
        client=client,
        body=body,
        x_spctre_integration_id=x_spctre_integration_id,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: IngestOtlpLogsBody,
    x_spctre_integration_id: UUID,
) -> Response[Any | ApiError]:
    """Ingest OTLP/HTTP JSON log records

    Args:
        x_spctre_integration_id (UUID):
        body (IngestOtlpLogsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ApiError]
    """

    kwargs = _get_kwargs(
        body=body,
        x_spctre_integration_id=x_spctre_integration_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: IngestOtlpLogsBody,
    x_spctre_integration_id: UUID,
) -> Any | ApiError | None:
    """Ingest OTLP/HTTP JSON log records

    Args:
        x_spctre_integration_id (UUID):
        body (IngestOtlpLogsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ApiError
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            x_spctre_integration_id=x_spctre_integration_id,
        )
    ).parsed
