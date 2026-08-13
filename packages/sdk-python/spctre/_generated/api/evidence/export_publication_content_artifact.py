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
    hash_: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/evidence/publication-artifacts/{hash_}".format(
            hash_=quote(str(hash_), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | File | None:
    if response.status_code == 200:
        response_200 = File(payload=BytesIO(response.content))

        return response_200

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
) -> Response[ApiError | File]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    hash_: str,
    *,
    client: AuthenticatedClient,
) -> Response[ApiError | File]:
    """Export a retained publication artifact

     Returns retained exact bytes. Requires an evidence:export service token.

    Args:
        hash_ (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | File]
    """

    kwargs = _get_kwargs(
        hash_=hash_,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    hash_: str,
    *,
    client: AuthenticatedClient,
) -> ApiError | File | None:
    """Export a retained publication artifact

     Returns retained exact bytes. Requires an evidence:export service token.

    Args:
        hash_ (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | File
    """

    return sync_detailed(
        hash_=hash_,
        client=client,
    ).parsed


async def asyncio_detailed(
    hash_: str,
    *,
    client: AuthenticatedClient,
) -> Response[ApiError | File]:
    """Export a retained publication artifact

     Returns retained exact bytes. Requires an evidence:export service token.

    Args:
        hash_ (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | File]
    """

    kwargs = _get_kwargs(
        hash_=hash_,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    hash_: str,
    *,
    client: AuthenticatedClient,
) -> ApiError | File | None:
    """Export a retained publication artifact

     Returns retained exact bytes. Requires an evidence:export service token.

    Args:
        hash_ (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | File
    """

    return (
        await asyncio_detailed(
            hash_=hash_,
            client=client,
        )
    ).parsed
