from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.evidence_ingest_request import EvidenceIngestRequest
from ...models.evidence_ingest_response import EvidenceIngestResponse
from ...types import Response


def _get_kwargs(
    *,
    body: EvidenceIngestRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/evidence",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | EvidenceIngestResponse | None:
    if response.status_code == 200:
        response_200 = EvidenceIngestResponse.from_dict(response.json())

        return response_200

    if response.status_code == 201:
        response_201 = EvidenceIngestResponse.from_dict(response.json())

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

    if response.status_code == 503:
        response_503 = ApiError.from_dict(response.json())

        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ApiError | EvidenceIngestResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: EvidenceIngestRequest,
) -> Response[ApiError | EvidenceIngestResponse]:
    """Ingest a governance decision as evidence

     Records an agent runtime governance decision in the evidence store. Supports both standard mode
    (caller supplies policyRefs, artifactHash, policyContext) and gateway mode (server resolves policy
    context via revision-at-time lookup). Duplicate `decisionId` submissions return 200 with
    `deduplicated: true` and are suppressed.

    Args:
        body (EvidenceIngestRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | EvidenceIngestResponse]
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
    body: EvidenceIngestRequest,
) -> ApiError | EvidenceIngestResponse | None:
    """Ingest a governance decision as evidence

     Records an agent runtime governance decision in the evidence store. Supports both standard mode
    (caller supplies policyRefs, artifactHash, policyContext) and gateway mode (server resolves policy
    context via revision-at-time lookup). Duplicate `decisionId` submissions return 200 with
    `deduplicated: true` and are suppressed.

    Args:
        body (EvidenceIngestRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | EvidenceIngestResponse
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: EvidenceIngestRequest,
) -> Response[ApiError | EvidenceIngestResponse]:
    """Ingest a governance decision as evidence

     Records an agent runtime governance decision in the evidence store. Supports both standard mode
    (caller supplies policyRefs, artifactHash, policyContext) and gateway mode (server resolves policy
    context via revision-at-time lookup). Duplicate `decisionId` submissions return 200 with
    `deduplicated: true` and are suppressed.

    Args:
        body (EvidenceIngestRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | EvidenceIngestResponse]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: EvidenceIngestRequest,
) -> ApiError | EvidenceIngestResponse | None:
    """Ingest a governance decision as evidence

     Records an agent runtime governance decision in the evidence store. Supports both standard mode
    (caller supplies policyRefs, artifactHash, policyContext) and gateway mode (server resolves policy
    context via revision-at-time lookup). Duplicate `decisionId` submissions return 200 with
    `deduplicated: true` and are suppressed.

    Args:
        body (EvidenceIngestRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | EvidenceIngestResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
