from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.list_publication_attestations_response_200 import (
    ListPublicationAttestationsResponse200,
)
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    content_identity: str | Unset = UNSET,
    before: str | Unset = UNSET,
    limit: int | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["contentIdentity"] = content_identity

    params["before"] = before

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/evidence/publications",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | ListPublicationAttestationsResponse200 | None:
    if response.status_code == 200:
        response_200 = ListPublicationAttestationsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = ApiError.from_dict(response.json())

        return response_401

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ApiError | ListPublicationAttestationsResponse200]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    content_identity: str | Unset = UNSET,
    before: str | Unset = UNSET,
    limit: int | Unset = UNSET,
) -> Response[ApiError | ListPublicationAttestationsResponse200]:
    """List immutable publication attestations

     Returns publication fact metadata. Requires an evidence:read service token.

    Args:
        content_identity (str | Unset):
        before (str | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | ListPublicationAttestationsResponse200]
    """

    kwargs = _get_kwargs(
        content_identity=content_identity,
        before=before,
        limit=limit,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    content_identity: str | Unset = UNSET,
    before: str | Unset = UNSET,
    limit: int | Unset = UNSET,
) -> ApiError | ListPublicationAttestationsResponse200 | None:
    """List immutable publication attestations

     Returns publication fact metadata. Requires an evidence:read service token.

    Args:
        content_identity (str | Unset):
        before (str | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | ListPublicationAttestationsResponse200
    """

    return sync_detailed(
        client=client,
        content_identity=content_identity,
        before=before,
        limit=limit,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    content_identity: str | Unset = UNSET,
    before: str | Unset = UNSET,
    limit: int | Unset = UNSET,
) -> Response[ApiError | ListPublicationAttestationsResponse200]:
    """List immutable publication attestations

     Returns publication fact metadata. Requires an evidence:read service token.

    Args:
        content_identity (str | Unset):
        before (str | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | ListPublicationAttestationsResponse200]
    """

    kwargs = _get_kwargs(
        content_identity=content_identity,
        before=before,
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    content_identity: str | Unset = UNSET,
    before: str | Unset = UNSET,
    limit: int | Unset = UNSET,
) -> ApiError | ListPublicationAttestationsResponse200 | None:
    """List immutable publication attestations

     Returns publication fact metadata. Requires an evidence:read service token.

    Args:
        content_identity (str | Unset):
        before (str | Unset):
        limit (int | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | ListPublicationAttestationsResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            content_identity=content_identity,
            before=before,
            limit=limit,
        )
    ).parsed
