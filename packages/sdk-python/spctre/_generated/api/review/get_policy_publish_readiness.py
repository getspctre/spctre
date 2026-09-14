from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.policy_publish_readiness_response import PolicyPublishReadinessResponse
from ...types import UNSET, Response


def _get_kwargs(
    *,
    branch_id: str,
    revision_id: str,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["branchId"] = branch_id

    params["revisionId"] = revision_id

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/policy/publishes/readiness",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | PolicyPublishReadinessResponse | None:
    if response.status_code == 200:
        response_200 = PolicyPublishReadinessResponse.from_dict(response.json())

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

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ApiError | PolicyPublishReadinessResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    branch_id: str,
    revision_id: str,
) -> Response[ApiError | PolicyPublishReadinessResponse]:
    """Report whether a revision can be published yet

     Runs the same readiness check the publish path runs and reports what is still blocking, without
    publishing anything. Requires only `approvals:read`. A READY answer is the answer `POST
    /policy/publishes` would act on.

    Args:
        branch_id (str):
        revision_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | PolicyPublishReadinessResponse]
    """

    kwargs = _get_kwargs(
        branch_id=branch_id,
        revision_id=revision_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    branch_id: str,
    revision_id: str,
) -> ApiError | PolicyPublishReadinessResponse | None:
    """Report whether a revision can be published yet

     Runs the same readiness check the publish path runs and reports what is still blocking, without
    publishing anything. Requires only `approvals:read`. A READY answer is the answer `POST
    /policy/publishes` would act on.

    Args:
        branch_id (str):
        revision_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | PolicyPublishReadinessResponse
    """

    return sync_detailed(
        client=client,
        branch_id=branch_id,
        revision_id=revision_id,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    branch_id: str,
    revision_id: str,
) -> Response[ApiError | PolicyPublishReadinessResponse]:
    """Report whether a revision can be published yet

     Runs the same readiness check the publish path runs and reports what is still blocking, without
    publishing anything. Requires only `approvals:read`. A READY answer is the answer `POST
    /policy/publishes` would act on.

    Args:
        branch_id (str):
        revision_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | PolicyPublishReadinessResponse]
    """

    kwargs = _get_kwargs(
        branch_id=branch_id,
        revision_id=revision_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    branch_id: str,
    revision_id: str,
) -> ApiError | PolicyPublishReadinessResponse | None:
    """Report whether a revision can be published yet

     Runs the same readiness check the publish path runs and reports what is still blocking, without
    publishing anything. Requires only `approvals:read`. A READY answer is the answer `POST
    /policy/publishes` would act on.

    Args:
        branch_id (str):
        revision_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | PolicyPublishReadinessResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            branch_id=branch_id,
            revision_id=revision_id,
        )
    ).parsed
