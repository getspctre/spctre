from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.gateway_decision_request import GatewayDecisionRequest
from ...models.gateway_decision_response import GatewayDecisionResponse
from ...types import Response


def _get_kwargs(
    *,
    body: GatewayDecisionRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/gateway/decide",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | GatewayDecisionResponse | None:
    if response.status_code == 200:
        response_200 = GatewayDecisionResponse.from_dict(response.json())

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
) -> Response[ApiError | GatewayDecisionResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: GatewayDecisionRequest,
) -> Response[ApiError | GatewayDecisionResponse]:
    """Evaluate a gateway decision

     Evaluates a governance decision against the active policy bundle and returns an outcome (`PROCEED`,
    `ESCALATE`, or `ABORT`). When the gateway is disabled the response always returns `PROCEED`.
    Decisions that trigger `shouldQueue: true` are placed in the escalation queue.

    Args:
        body (GatewayDecisionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | GatewayDecisionResponse]
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
    body: GatewayDecisionRequest,
) -> ApiError | GatewayDecisionResponse | None:
    """Evaluate a gateway decision

     Evaluates a governance decision against the active policy bundle and returns an outcome (`PROCEED`,
    `ESCALATE`, or `ABORT`). When the gateway is disabled the response always returns `PROCEED`.
    Decisions that trigger `shouldQueue: true` are placed in the escalation queue.

    Args:
        body (GatewayDecisionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | GatewayDecisionResponse
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: GatewayDecisionRequest,
) -> Response[ApiError | GatewayDecisionResponse]:
    """Evaluate a gateway decision

     Evaluates a governance decision against the active policy bundle and returns an outcome (`PROCEED`,
    `ESCALATE`, or `ABORT`). When the gateway is disabled the response always returns `PROCEED`.
    Decisions that trigger `shouldQueue: true` are placed in the escalation queue.

    Args:
        body (GatewayDecisionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | GatewayDecisionResponse]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: GatewayDecisionRequest,
) -> ApiError | GatewayDecisionResponse | None:
    """Evaluate a gateway decision

     Evaluates a governance decision against the active policy bundle and returns an outcome (`PROCEED`,
    `ESCALATE`, or `ABORT`). When the gateway is disabled the response always returns `PROCEED`.
    Decisions that trigger `shouldQueue: true` are placed in the escalation queue.

    Args:
        body (GatewayDecisionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | GatewayDecisionResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
