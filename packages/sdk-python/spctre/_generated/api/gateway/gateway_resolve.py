from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.gateway_resolve_request import GatewayResolveRequest
from ...models.gateway_resolve_response_200 import GatewayResolveResponse200
from ...types import Response


def _get_kwargs(
    *,
    body: GatewayResolveRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/gateway/resolve",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | GatewayResolveResponse200 | None:
    if response.status_code == 200:
        response_200 = GatewayResolveResponse200.from_dict(response.json())

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
) -> Response[ApiError | GatewayResolveResponse200]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: GatewayResolveRequest,
) -> Response[ApiError | GatewayResolveResponse200]:
    """Resolve an escalation queue item

     Closes an open escalation queue item with a resolution outcome (`PROCEED`, `ESCALATE`, or `ABORT`).
    Requires web session authentication — this operation represents a human-in-the-loop decision.

    Args:
        body (GatewayResolveRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | GatewayResolveResponse200]
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
    client: AuthenticatedClient | Client,
    body: GatewayResolveRequest,
) -> ApiError | GatewayResolveResponse200 | None:
    """Resolve an escalation queue item

     Closes an open escalation queue item with a resolution outcome (`PROCEED`, `ESCALATE`, or `ABORT`).
    Requires web session authentication — this operation represents a human-in-the-loop decision.

    Args:
        body (GatewayResolveRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | GatewayResolveResponse200
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: GatewayResolveRequest,
) -> Response[ApiError | GatewayResolveResponse200]:
    """Resolve an escalation queue item

     Closes an open escalation queue item with a resolution outcome (`PROCEED`, `ESCALATE`, or `ABORT`).
    Requires web session authentication — this operation represents a human-in-the-loop decision.

    Args:
        body (GatewayResolveRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | GatewayResolveResponse200]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: GatewayResolveRequest,
) -> ApiError | GatewayResolveResponse200 | None:
    """Resolve an escalation queue item

     Closes an open escalation queue item with a resolution outcome (`PROCEED`, `ESCALATE`, or `ABORT`).
    Requires web session authentication — this operation represents a human-in-the-loop decision.

    Args:
        body (GatewayResolveRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | GatewayResolveResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
