from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.scim_create_user_body import ScimCreateUserBody
from ...models.scim_create_user_response_201 import ScimCreateUserResponse201
from ...models.scim_create_user_response_402 import ScimCreateUserResponse402
from ...types import Response


def _get_kwargs(
    *,
    body: ScimCreateUserBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/scim/v2/Users",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/scim+json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | ScimCreateUserResponse201 | ScimCreateUserResponse402 | None:
    if response.status_code == 201:
        response_201 = ScimCreateUserResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 401:
        response_401 = ApiError.from_dict(response.json())

        return response_401

    if response.status_code == 402:
        response_402 = ScimCreateUserResponse402.from_dict(response.json())

        return response_402

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ApiError | ScimCreateUserResponse201 | ScimCreateUserResponse402]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: ScimCreateUserBody,
) -> Response[ApiError | ScimCreateUserResponse201 | ScimCreateUserResponse402]:
    """SCIM 2.0 — create user

     Provision a new user via SCIM 2.0.

    Args:
        body (ScimCreateUserBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | ScimCreateUserResponse201 | ScimCreateUserResponse402]
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
    body: ScimCreateUserBody,
) -> ApiError | ScimCreateUserResponse201 | ScimCreateUserResponse402 | None:
    """SCIM 2.0 — create user

     Provision a new user via SCIM 2.0.

    Args:
        body (ScimCreateUserBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | ScimCreateUserResponse201 | ScimCreateUserResponse402
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: ScimCreateUserBody,
) -> Response[ApiError | ScimCreateUserResponse201 | ScimCreateUserResponse402]:
    """SCIM 2.0 — create user

     Provision a new user via SCIM 2.0.

    Args:
        body (ScimCreateUserBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | ScimCreateUserResponse201 | ScimCreateUserResponse402]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: ScimCreateUserBody,
) -> ApiError | ScimCreateUserResponse201 | ScimCreateUserResponse402 | None:
    """SCIM 2.0 — create user

     Provision a new user via SCIM 2.0.

    Args:
        body (ScimCreateUserBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | ScimCreateUserResponse201 | ScimCreateUserResponse402
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
