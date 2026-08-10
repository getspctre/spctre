from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.escalation_status_response import EscalationStatusResponse
from ...types import UNSET, Response


def _get_kwargs(
    *,
    decision_id: str,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["decisionId"] = decision_id

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/gateway/escalations/status",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | EscalationStatusResponse | None:
    if response.status_code == 200:
        response_200 = EscalationStatusResponse.from_dict(response.json())

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

    if response.status_code == 503:
        response_503 = ApiError.from_dict(response.json())

        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ApiError | EscalationStatusResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    decision_id: str,
) -> Response[ApiError | EscalationStatusResponse]:
    """Get gateway decision escalation status

     Checks the current status of an escalation queue item by its decision ID.

    Args:
        decision_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | EscalationStatusResponse]
    """

    kwargs = _get_kwargs(
        decision_id=decision_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    decision_id: str,
) -> ApiError | EscalationStatusResponse | None:
    """Get gateway decision escalation status

     Checks the current status of an escalation queue item by its decision ID.

    Args:
        decision_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | EscalationStatusResponse
    """

    return sync_detailed(
        client=client,
        decision_id=decision_id,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    decision_id: str,
) -> Response[ApiError | EscalationStatusResponse]:
    """Get gateway decision escalation status

     Checks the current status of an escalation queue item by its decision ID.

    Args:
        decision_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | EscalationStatusResponse]
    """

    kwargs = _get_kwargs(
        decision_id=decision_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    decision_id: str,
) -> ApiError | EscalationStatusResponse | None:
    """Get gateway decision escalation status

     Checks the current status of an escalation queue item by its decision ID.

    Args:
        decision_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | EscalationStatusResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            decision_id=decision_id,
        )
    ).parsed
