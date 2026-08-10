from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.ingest_trust_score_response_201 import IngestTrustScoreResponse201
from ...models.trust_score_ingest_request import TrustScoreIngestRequest
from ...types import Response


def _get_kwargs(
    *,
    body: TrustScoreIngestRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/trust/ingest",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | IngestTrustScoreResponse201 | None:
    if response.status_code == 201:
        response_201 = IngestTrustScoreResponse201.from_dict(response.json())

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
) -> Response[ApiError | IngestTrustScoreResponse201]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: TrustScoreIngestRequest,
) -> Response[ApiError | IngestTrustScoreResponse201]:
    """Ingest a trust-score observation

     Records a trust-score observation for an agent, computes score delta against the prior observation,
    and appends a trust-score operations-log event.

    Args:
        body (TrustScoreIngestRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | IngestTrustScoreResponse201]
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
    body: TrustScoreIngestRequest,
) -> ApiError | IngestTrustScoreResponse201 | None:
    """Ingest a trust-score observation

     Records a trust-score observation for an agent, computes score delta against the prior observation,
    and appends a trust-score operations-log event.

    Args:
        body (TrustScoreIngestRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | IngestTrustScoreResponse201
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: TrustScoreIngestRequest,
) -> Response[ApiError | IngestTrustScoreResponse201]:
    """Ingest a trust-score observation

     Records a trust-score observation for an agent, computes score delta against the prior observation,
    and appends a trust-score operations-log event.

    Args:
        body (TrustScoreIngestRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | IngestTrustScoreResponse201]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: TrustScoreIngestRequest,
) -> ApiError | IngestTrustScoreResponse201 | None:
    """Ingest a trust-score observation

     Records a trust-score observation for an agent, computes score delta against the prior observation,
    and appends a trust-score operations-log event.

    Args:
        body (TrustScoreIngestRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | IngestTrustScoreResponse201
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
