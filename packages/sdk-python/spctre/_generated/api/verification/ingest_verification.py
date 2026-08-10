from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.verification_ingest_request import VerificationIngestRequest
from ...models.verification_ingest_response import VerificationIngestResponse
from ...types import Response


def _get_kwargs(
    *,
    body: VerificationIngestRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/verification",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | VerificationIngestResponse | None:
    if response.status_code == 201:
        response_201 = VerificationIngestResponse.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = ApiError.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ApiError.from_dict(response.json())

        return response_401

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ApiError | VerificationIngestResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: VerificationIngestRequest,
) -> Response[ApiError | VerificationIngestResponse]:
    """Ingest a verification result

     Records the outcome of a policy verification run (lint, evidence coverage check, red-team, or
    custom) against a specific policy artifact.

    Args:
        body (VerificationIngestRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | VerificationIngestResponse]
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
    body: VerificationIngestRequest,
) -> ApiError | VerificationIngestResponse | None:
    """Ingest a verification result

     Records the outcome of a policy verification run (lint, evidence coverage check, red-team, or
    custom) against a specific policy artifact.

    Args:
        body (VerificationIngestRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | VerificationIngestResponse
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: VerificationIngestRequest,
) -> Response[ApiError | VerificationIngestResponse]:
    """Ingest a verification result

     Records the outcome of a policy verification run (lint, evidence coverage check, red-team, or
    custom) against a specific policy artifact.

    Args:
        body (VerificationIngestRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | VerificationIngestResponse]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: VerificationIngestRequest,
) -> ApiError | VerificationIngestResponse | None:
    """Ingest a verification result

     Records the outcome of a policy verification run (lint, evidence coverage check, red-team, or
    custom) against a specific policy artifact.

    Args:
        body (VerificationIngestRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | VerificationIngestResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
