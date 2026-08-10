from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.token_refresh_request import TokenRefreshRequest
from ...models.token_refresh_response import TokenRefreshResponse
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: TokenRefreshRequest,
    idempotency_key: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(idempotency_key, Unset):
        headers["Idempotency-Key"] = idempotency_key

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/token/refresh",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | TokenRefreshResponse | None:
    if response.status_code == 200:
        response_200 = TokenRefreshResponse.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ApiError.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ApiError.from_dict(response.json())

        return response_401

    if response.status_code == 503:
        response_503 = ApiError.from_dict(response.json())

        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ApiError | TokenRefreshResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: TokenRefreshRequest,
    idempotency_key: str | Unset = UNSET,
) -> Response[ApiError | TokenRefreshResponse]:
    """Rotate an access/refresh token pair

     Exchanges a valid refresh token for a fresh short-lived access token and rolling refresh token. The
    previous access token is revoked and the previous refresh token is marked rotated.

    Args:
        idempotency_key (str | Unset):
        body (TokenRefreshRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | TokenRefreshResponse]
    """

    kwargs = _get_kwargs(
        body=body,
        idempotency_key=idempotency_key,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    body: TokenRefreshRequest,
    idempotency_key: str | Unset = UNSET,
) -> ApiError | TokenRefreshResponse | None:
    """Rotate an access/refresh token pair

     Exchanges a valid refresh token for a fresh short-lived access token and rolling refresh token. The
    previous access token is revoked and the previous refresh token is marked rotated.

    Args:
        idempotency_key (str | Unset):
        body (TokenRefreshRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | TokenRefreshResponse
    """

    return sync_detailed(
        client=client,
        body=body,
        idempotency_key=idempotency_key,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: TokenRefreshRequest,
    idempotency_key: str | Unset = UNSET,
) -> Response[ApiError | TokenRefreshResponse]:
    """Rotate an access/refresh token pair

     Exchanges a valid refresh token for a fresh short-lived access token and rolling refresh token. The
    previous access token is revoked and the previous refresh token is marked rotated.

    Args:
        idempotency_key (str | Unset):
        body (TokenRefreshRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | TokenRefreshResponse]
    """

    kwargs = _get_kwargs(
        body=body,
        idempotency_key=idempotency_key,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: TokenRefreshRequest,
    idempotency_key: str | Unset = UNSET,
) -> ApiError | TokenRefreshResponse | None:
    """Rotate an access/refresh token pair

     Exchanges a valid refresh token for a fresh short-lived access token and rolling refresh token. The
    previous access token is revoked and the previous refresh token is marked rotated.

    Args:
        idempotency_key (str | Unset):
        body (TokenRefreshRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | TokenRefreshResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            idempotency_key=idempotency_key,
        )
    ).parsed
