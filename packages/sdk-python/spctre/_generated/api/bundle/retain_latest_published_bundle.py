from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.retain_latest_published_bundle_response_201 import (
    RetainLatestPublishedBundleResponse201,
)
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/bundle/latest/custody",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | RetainLatestPublishedBundleResponse201 | None:
    if response.status_code == 201:
        response_201 = RetainLatestPublishedBundleResponse201.from_dict(response.json())

        return response_201

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
) -> Response[ApiError | RetainLatestPublishedBundleResponse201]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[ApiError | RetainLatestPublishedBundleResponse201]:
    """Retain exact bytes of the latest published policy bundle

     Materializes the exact raw bundle bytes under their SHA-256 content hash and links them atomically
    to the immutable policy publication event. This is distinct from the semantic artifact hash and is
    safe to call repeatedly.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | RetainLatestPublishedBundleResponse201]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> ApiError | RetainLatestPublishedBundleResponse201 | None:
    """Retain exact bytes of the latest published policy bundle

     Materializes the exact raw bundle bytes under their SHA-256 content hash and links them atomically
    to the immutable policy publication event. This is distinct from the semantic artifact hash and is
    safe to call repeatedly.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | RetainLatestPublishedBundleResponse201
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[ApiError | RetainLatestPublishedBundleResponse201]:
    """Retain exact bytes of the latest published policy bundle

     Materializes the exact raw bundle bytes under their SHA-256 content hash and links them atomically
    to the immutable policy publication event. This is distinct from the semantic artifact hash and is
    safe to call repeatedly.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | RetainLatestPublishedBundleResponse201]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> ApiError | RetainLatestPublishedBundleResponse201 | None:
    """Retain exact bytes of the latest published policy bundle

     Materializes the exact raw bundle bytes under their SHA-256 content hash and links them atomically
    to the immutable policy publication event. This is distinct from the semantic artifact hash and is
    safe to call repeatedly.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | RetainLatestPublishedBundleResponse201
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
