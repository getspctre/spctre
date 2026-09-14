from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.simulation_run_request import SimulationRunRequest
from ...models.simulation_run_response import SimulationRunResponse
from ...types import Response


def _get_kwargs(
    *,
    body: SimulationRunRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/simulations",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | SimulationRunResponse | None:
    if response.status_code == 201:
        response_201 = SimulationRunResponse.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = ApiError.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ApiError.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = ApiError.from_dict(response.json())

        return response_403

    if response.status_code == 422:
        response_422 = ApiError.from_dict(response.json())

        return response_422

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ApiError | SimulationRunResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: SimulationRunRequest,
) -> Response[ApiError | SimulationRunResponse]:
    """Replay retained evidence against a revision

     Runs a managed simulation for a revision, replaying the workspace's retained evidence against it and
    recording the run with its regression summary. Requires the `simulation:run` scope; the run is
    attributed to the principal the token was issued to. Unlike approving or publishing, this authorizes
    on the scope alone — a replay decides nothing, it reports what the revision would have done to
    traffic that already happened. On a workspace entitled to bulk production simulation, publishing is
    blocked until a managed run exists for the revision, so an automated promotion needs this to finish
    the reviewed path. The gate is unchanged: publish still refuses a run whose regressions are
    blocking. 422 means there is nothing to replay yet.

    Args:
        body (SimulationRunRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | SimulationRunResponse]
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
    body: SimulationRunRequest,
) -> ApiError | SimulationRunResponse | None:
    """Replay retained evidence against a revision

     Runs a managed simulation for a revision, replaying the workspace's retained evidence against it and
    recording the run with its regression summary. Requires the `simulation:run` scope; the run is
    attributed to the principal the token was issued to. Unlike approving or publishing, this authorizes
    on the scope alone — a replay decides nothing, it reports what the revision would have done to
    traffic that already happened. On a workspace entitled to bulk production simulation, publishing is
    blocked until a managed run exists for the revision, so an automated promotion needs this to finish
    the reviewed path. The gate is unchanged: publish still refuses a run whose regressions are
    blocking. 422 means there is nothing to replay yet.

    Args:
        body (SimulationRunRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | SimulationRunResponse
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: SimulationRunRequest,
) -> Response[ApiError | SimulationRunResponse]:
    """Replay retained evidence against a revision

     Runs a managed simulation for a revision, replaying the workspace's retained evidence against it and
    recording the run with its regression summary. Requires the `simulation:run` scope; the run is
    attributed to the principal the token was issued to. Unlike approving or publishing, this authorizes
    on the scope alone — a replay decides nothing, it reports what the revision would have done to
    traffic that already happened. On a workspace entitled to bulk production simulation, publishing is
    blocked until a managed run exists for the revision, so an automated promotion needs this to finish
    the reviewed path. The gate is unchanged: publish still refuses a run whose regressions are
    blocking. 422 means there is nothing to replay yet.

    Args:
        body (SimulationRunRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | SimulationRunResponse]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: SimulationRunRequest,
) -> ApiError | SimulationRunResponse | None:
    """Replay retained evidence against a revision

     Runs a managed simulation for a revision, replaying the workspace's retained evidence against it and
    recording the run with its regression summary. Requires the `simulation:run` scope; the run is
    attributed to the principal the token was issued to. Unlike approving or publishing, this authorizes
    on the scope alone — a replay decides nothing, it reports what the revision would have done to
    traffic that already happened. On a workspace entitled to bulk production simulation, publishing is
    blocked until a managed run exists for the revision, so an automated promotion needs this to finish
    the reviewed path. The gate is unchanged: publish still refuses a run whose regressions are
    blocking. 422 means there is nothing to replay yet.

    Args:
        body (SimulationRunRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | SimulationRunResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
