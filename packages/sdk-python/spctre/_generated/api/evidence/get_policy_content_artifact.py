from http import HTTPStatus
from io import BytesIO
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...types import File, Response


def _get_kwargs(
    content_hash: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/evidence/policy-artifacts/{content_hash}".format(
            content_hash=quote(str(content_hash), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | File | None:
    if response.status_code == 200:
        response_200 = File(payload=BytesIO(response.json()))

        return response_200

    if response.status_code == 400:
        response_400 = ApiError.from_dict(response.json())

        return response_400

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
) -> Response[ApiError | File]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    content_hash: str,
    *,
    client: AuthenticatedClient,
) -> Response[ApiError | File]:
    """Read a policy artifact referenced by authorized evidence

     Returns the original retained bytes only when the caller's connector and active revision grant can
    reference the artifact through retained runtime evidence. Unauthorized and absent artifacts
    intentionally produce the same 404 response.

    Args:
        content_hash (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | File]
    """

    kwargs = _get_kwargs(
        content_hash=content_hash,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    content_hash: str,
    *,
    client: AuthenticatedClient,
) -> ApiError | File | None:
    """Read a policy artifact referenced by authorized evidence

     Returns the original retained bytes only when the caller's connector and active revision grant can
    reference the artifact through retained runtime evidence. Unauthorized and absent artifacts
    intentionally produce the same 404 response.

    Args:
        content_hash (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | File
    """

    return sync_detailed(
        content_hash=content_hash,
        client=client,
    ).parsed


async def asyncio_detailed(
    content_hash: str,
    *,
    client: AuthenticatedClient,
) -> Response[ApiError | File]:
    """Read a policy artifact referenced by authorized evidence

     Returns the original retained bytes only when the caller's connector and active revision grant can
    reference the artifact through retained runtime evidence. Unauthorized and absent artifacts
    intentionally produce the same 404 response.

    Args:
        content_hash (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | File]
    """

    kwargs = _get_kwargs(
        content_hash=content_hash,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    content_hash: str,
    *,
    client: AuthenticatedClient,
) -> ApiError | File | None:
    """Read a policy artifact referenced by authorized evidence

     Returns the original retained bytes only when the caller's connector and active revision grant can
    reference the artifact through retained runtime evidence. Unauthorized and absent artifacts
    intentionally produce the same 404 response.

    Args:
        content_hash (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | File
    """

    return (
        await asyncio_detailed(
            content_hash=content_hash,
            client=client,
        )
    ).parsed
