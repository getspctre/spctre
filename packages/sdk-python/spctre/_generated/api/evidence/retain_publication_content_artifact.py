from http import HTTPStatus
from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.publication_content_artifact_retain_response import (
    PublicationContentArtifactRetainResponse,
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
        "url": "/evidence/publication-artifacts",
    }

    _kwargs["content"] = body.payload
    headers["Content-Type"] = "application/octet-stream"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | ApiError | PublicationContentArtifactRetainResponse | None:
    if response.status_code == 201:
        response_201 = PublicationContentArtifactRetainResponse.from_dict(
            response.json()
        )

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

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | ApiError | PublicationContentArtifactRetainResponse]:
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
) -> Response[Any | ApiError | PublicationContentArtifactRetainResponse]:
    """Retain a byte-exact publication content artifact

     Stores exact publication bytes addressed by X-Spctre-Content-Hash. The artifact must be retained
    before a publication attestation can reference it.

    Args:
        x_spctre_content_hash (str):
        body (File):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ApiError | PublicationContentArtifactRetainResponse]
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
) -> Any | ApiError | PublicationContentArtifactRetainResponse | None:
    """Retain a byte-exact publication content artifact

     Stores exact publication bytes addressed by X-Spctre-Content-Hash. The artifact must be retained
    before a publication attestation can reference it.

    Args:
        x_spctre_content_hash (str):
        body (File):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ApiError | PublicationContentArtifactRetainResponse
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
) -> Response[Any | ApiError | PublicationContentArtifactRetainResponse]:
    """Retain a byte-exact publication content artifact

     Stores exact publication bytes addressed by X-Spctre-Content-Hash. The artifact must be retained
    before a publication attestation can reference it.

    Args:
        x_spctre_content_hash (str):
        body (File):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ApiError | PublicationContentArtifactRetainResponse]
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
) -> Any | ApiError | PublicationContentArtifactRetainResponse | None:
    """Retain a byte-exact publication content artifact

     Stores exact publication bytes addressed by X-Spctre-Content-Hash. The artifact must be retained
    before a publication attestation can reference it.

    Args:
        x_spctre_content_hash (str):
        body (File):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ApiError | PublicationContentArtifactRetainResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            x_spctre_content_hash=x_spctre_content_hash,
        )
    ).parsed
