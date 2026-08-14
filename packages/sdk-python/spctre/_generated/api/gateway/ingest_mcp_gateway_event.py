from http import HTTPStatus
from typing import Any, cast

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.ingest_mcp_gateway_event_body import IngestMcpGatewayEventBody
from ...types import Response


def _get_kwargs(
    *,
    body: IngestMcpGatewayEventBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/gateway-ingest/mcp",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | ApiError | None:
    if response.status_code == 200:
        response_200 = cast(Any, None)
        return response_200

    if response.status_code == 201:
        response_201 = cast(Any, None)
        return response_201

    if response.status_code == 400:
        response_400 = ApiError.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ApiError.from_dict(response.json())

        return response_401

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | ApiError]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: IngestMcpGatewayEventBody,
) -> Response[Any | ApiError]:
    """Ingest an MCP gateway event

     The MCP member of the gateway-ingest family, alongside the Helicone, LiteLLM, Notion, and Portkey
    receivers.

    Args:
        body (IngestMcpGatewayEventBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ApiError]
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
    body: IngestMcpGatewayEventBody,
) -> Any | ApiError | None:
    """Ingest an MCP gateway event

     The MCP member of the gateway-ingest family, alongside the Helicone, LiteLLM, Notion, and Portkey
    receivers.

    Args:
        body (IngestMcpGatewayEventBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ApiError
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: IngestMcpGatewayEventBody,
) -> Response[Any | ApiError]:
    """Ingest an MCP gateway event

     The MCP member of the gateway-ingest family, alongside the Helicone, LiteLLM, Notion, and Portkey
    receivers.

    Args:
        body (IngestMcpGatewayEventBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | ApiError]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: IngestMcpGatewayEventBody,
) -> Any | ApiError | None:
    """Ingest an MCP gateway event

     The MCP member of the gateway-ingest family, alongside the Helicone, LiteLLM, Notion, and Portkey
    receivers.

    Args:
        body (IngestMcpGatewayEventBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | ApiError
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
