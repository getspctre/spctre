from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.scim_list_users_response_200 import ScimListUsersResponse200
from ...models.scim_list_users_response_402 import ScimListUsersResponse402
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    filter_: str | Unset = UNSET,
    start_index: int | Unset = 1,
    count: int | Unset = 100,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["filter"] = filter_

    params["startIndex"] = start_index

    params["count"] = count

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/scim/v2/Users",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | ScimListUsersResponse200 | ScimListUsersResponse402 | None:
    if response.status_code == 200:
        response_200 = ScimListUsersResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = ApiError.from_dict(response.json())

        return response_401

    if response.status_code == 402:
        response_402 = ScimListUsersResponse402.from_dict(response.json())

        return response_402

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ApiError | ScimListUsersResponse200 | ScimListUsersResponse402]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    filter_: str | Unset = UNSET,
    start_index: int | Unset = 1,
    count: int | Unset = 100,
) -> Response[ApiError | ScimListUsersResponse200 | ScimListUsersResponse402]:
    """SCIM 2.0 — list users

     SCIM 2.0 user provisioning endpoint for IdP integration.

    Args:
        filter_ (str | Unset):
        start_index (int | Unset):  Default: 1.
        count (int | Unset):  Default: 100.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | ScimListUsersResponse200 | ScimListUsersResponse402]
    """

    kwargs = _get_kwargs(
        filter_=filter_,
        start_index=start_index,
        count=count,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    filter_: str | Unset = UNSET,
    start_index: int | Unset = 1,
    count: int | Unset = 100,
) -> ApiError | ScimListUsersResponse200 | ScimListUsersResponse402 | None:
    """SCIM 2.0 — list users

     SCIM 2.0 user provisioning endpoint for IdP integration.

    Args:
        filter_ (str | Unset):
        start_index (int | Unset):  Default: 1.
        count (int | Unset):  Default: 100.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | ScimListUsersResponse200 | ScimListUsersResponse402
    """

    return sync_detailed(
        client=client,
        filter_=filter_,
        start_index=start_index,
        count=count,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    filter_: str | Unset = UNSET,
    start_index: int | Unset = 1,
    count: int | Unset = 100,
) -> Response[ApiError | ScimListUsersResponse200 | ScimListUsersResponse402]:
    """SCIM 2.0 — list users

     SCIM 2.0 user provisioning endpoint for IdP integration.

    Args:
        filter_ (str | Unset):
        start_index (int | Unset):  Default: 1.
        count (int | Unset):  Default: 100.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | ScimListUsersResponse200 | ScimListUsersResponse402]
    """

    kwargs = _get_kwargs(
        filter_=filter_,
        start_index=start_index,
        count=count,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    filter_: str | Unset = UNSET,
    start_index: int | Unset = 1,
    count: int | Unset = 100,
) -> ApiError | ScimListUsersResponse200 | ScimListUsersResponse402 | None:
    """SCIM 2.0 — list users

     SCIM 2.0 user provisioning endpoint for IdP integration.

    Args:
        filter_ (str | Unset):
        start_index (int | Unset):  Default: 1.
        count (int | Unset):  Default: 100.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | ScimListUsersResponse200 | ScimListUsersResponse402
    """

    return (
        await asyncio_detailed(
            client=client,
            filter_=filter_,
            start_index=start_index,
            count=count,
        )
    ).parsed
