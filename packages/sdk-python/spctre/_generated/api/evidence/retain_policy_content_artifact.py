from http import HTTPStatus
from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.policy_content_artifact_retain_response import (
    PolicyContentArtifactRetainResponse,
)
from ...types import File, Response


def _get_kwargs(
    *,
    body: File,
    x_spctre_content_hash: str,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    headers["X-Spctre-Content-Hash"] = x_spctre_content_hash

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/evidence/policy-artifacts",
    }

    _kwargs["json"] = body.to_tuple()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | ApiError | PolicyContentArtifactRetainResponse | None:
    if response.status_code == 201:
        response_201 = PolicyContentArtifactRetainResponse.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = ApiError.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ApiError.from_dict(response.json())

        return response_401

    if response.status_code == 413:
        response_413 = cast(Any, None)
        return response_413

    if response.status_code == 503:
        response_503 = ApiError.from_dict(response.json())

        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | ApiError | PolicyContentArtifactRetainResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: File,
    x_spctre_content_hash: str,
) -> Response[Any | ApiError | PolicyContentArtifactRetainResponse]:
    """Retain a byte-exact policy content artifact

     Stores the exact policy bytes addressed by `X-Spctre-Content-Hash`. Requires an `evidence:export`
    service token bound to a connector with at least one active revision grant. The server enforces the
    media type, 10 MiB limit, and claimed SHA-256 hash before encrypted retention.

    Args:
        x_spctre_content_hash (str):
        body (File):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ApiError | PolicyContentArtifactRetainResponse]
    """

    kwargs = _get_kwargs(
        body=body,
        x_spctre_content_hash=x_spctre_content_hash,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: File,
    x_spctre_content_hash: str,
) -> Any | ApiError | PolicyContentArtifactRetainResponse | None:
    """Retain a byte-exact policy content artifact

     Stores the exact policy bytes addressed by `X-Spctre-Content-Hash`. Requires an `evidence:export`
    service token bound to a connector with at least one active revision grant. The server enforces the
    media type, 10 MiB limit, and claimed SHA-256 hash before encrypted retention.

    Args:
        x_spctre_content_hash (str):
        body (File):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ApiError | PolicyContentArtifactRetainResponse
    """

    return sync_detailed(
        client=client,
        body=body,
        x_spctre_content_hash=x_spctre_content_hash,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: File,
    x_spctre_content_hash: str,
) -> Response[Any | ApiError | PolicyContentArtifactRetainResponse]:
    """Retain a byte-exact policy content artifact

     Stores the exact policy bytes addressed by `X-Spctre-Content-Hash`. Requires an `evidence:export`
    service token bound to a connector with at least one active revision grant. The server enforces the
    media type, 10 MiB limit, and claimed SHA-256 hash before encrypted retention.

    Args:
        x_spctre_content_hash (str):
        body (File):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ApiError | PolicyContentArtifactRetainResponse]
    """

    kwargs = _get_kwargs(
        body=body,
        x_spctre_content_hash=x_spctre_content_hash,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: File,
    x_spctre_content_hash: str,
) -> Any | ApiError | PolicyContentArtifactRetainResponse | None:
    """Retain a byte-exact policy content artifact

     Stores the exact policy bytes addressed by `X-Spctre-Content-Hash`. Requires an `evidence:export`
    service token bound to a connector with at least one active revision grant. The server enforces the
    media type, 10 MiB limit, and claimed SHA-256 hash before encrypted retention.

    Args:
        x_spctre_content_hash (str):
        body (File):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ApiError | PolicyContentArtifactRetainResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            x_spctre_content_hash=x_spctre_content_hash,
        )
    ).parsed
