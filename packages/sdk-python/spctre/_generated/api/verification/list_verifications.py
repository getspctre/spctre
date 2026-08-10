from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.list_verifications_response_200 import ListVerificationsResponse200
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    revision_id: str | Unset = UNSET,
    artifact_hash: str | Unset = UNSET,
    limit: int | Unset = 50,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["revisionId"] = revision_id

    params["artifactHash"] = artifact_hash

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/verification",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | ListVerificationsResponse200 | None:
    if response.status_code == 200:
        response_200 = ListVerificationsResponse200.from_dict(response.json())

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
) -> Response[ApiError | ListVerificationsResponse200]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    revision_id: str | Unset = UNSET,
    artifact_hash: str | Unset = UNSET,
    limit: int | Unset = 50,
) -> Response[ApiError | ListVerificationsResponse200]:
    """List verification results

     Returns verification results for the workspace, optionally filtered by revisionId or artifactHash.

    Args:
        revision_id (str | Unset):
        artifact_hash (str | Unset):
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | ListVerificationsResponse200]
    """

    kwargs = _get_kwargs(
        revision_id=revision_id,
        artifact_hash=artifact_hash,
        limit=limit,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    revision_id: str | Unset = UNSET,
    artifact_hash: str | Unset = UNSET,
    limit: int | Unset = 50,
) -> ApiError | ListVerificationsResponse200 | None:
    """List verification results

     Returns verification results for the workspace, optionally filtered by revisionId or artifactHash.

    Args:
        revision_id (str | Unset):
        artifact_hash (str | Unset):
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | ListVerificationsResponse200
    """

    return sync_detailed(
        client=client,
        revision_id=revision_id,
        artifact_hash=artifact_hash,
        limit=limit,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    revision_id: str | Unset = UNSET,
    artifact_hash: str | Unset = UNSET,
    limit: int | Unset = 50,
) -> Response[ApiError | ListVerificationsResponse200]:
    """List verification results

     Returns verification results for the workspace, optionally filtered by revisionId or artifactHash.

    Args:
        revision_id (str | Unset):
        artifact_hash (str | Unset):
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | ListVerificationsResponse200]
    """

    kwargs = _get_kwargs(
        revision_id=revision_id,
        artifact_hash=artifact_hash,
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    revision_id: str | Unset = UNSET,
    artifact_hash: str | Unset = UNSET,
    limit: int | Unset = 50,
) -> ApiError | ListVerificationsResponse200 | None:
    """List verification results

     Returns verification results for the workspace, optionally filtered by revisionId or artifactHash.

    Args:
        revision_id (str | Unset):
        artifact_hash (str | Unset):
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | ListVerificationsResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            revision_id=revision_id,
            artifact_hash=artifact_hash,
            limit=limit,
        )
    ).parsed
