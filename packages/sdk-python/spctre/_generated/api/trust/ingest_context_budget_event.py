from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.context_budget_ingest_request import ContextBudgetIngestRequest
from ...models.ingest_context_budget_event_response_201 import (
    IngestContextBudgetEventResponse201,
)
from ...types import Response


def _get_kwargs(
    *,
    body: ContextBudgetIngestRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/trust/context-budget",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | IngestContextBudgetEventResponse201 | None:
    if response.status_code == 201:
        response_201 = IngestContextBudgetEventResponse201.from_dict(response.json())

        return response_201

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
) -> Response[ApiError | IngestContextBudgetEventResponse201]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: ContextBudgetIngestRequest,
) -> Response[ApiError | IngestContextBudgetEventResponse201]:
    """Ingest a context-budget telemetry event

     Records context token growth, summarization, source mix, or budget breach telemetry. Budget breaches
    are written to the operations log.

    Args:
        body (ContextBudgetIngestRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | IngestContextBudgetEventResponse201]
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
    body: ContextBudgetIngestRequest,
) -> ApiError | IngestContextBudgetEventResponse201 | None:
    """Ingest a context-budget telemetry event

     Records context token growth, summarization, source mix, or budget breach telemetry. Budget breaches
    are written to the operations log.

    Args:
        body (ContextBudgetIngestRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | IngestContextBudgetEventResponse201
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: ContextBudgetIngestRequest,
) -> Response[ApiError | IngestContextBudgetEventResponse201]:
    """Ingest a context-budget telemetry event

     Records context token growth, summarization, source mix, or budget breach telemetry. Budget breaches
    are written to the operations log.

    Args:
        body (ContextBudgetIngestRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | IngestContextBudgetEventResponse201]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: ContextBudgetIngestRequest,
) -> ApiError | IngestContextBudgetEventResponse201 | None:
    """Ingest a context-budget telemetry event

     Records context token growth, summarization, source mix, or budget breach telemetry. Budget breaches
    are written to the operations log.

    Args:
        body (ContextBudgetIngestRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | IngestContextBudgetEventResponse201
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
