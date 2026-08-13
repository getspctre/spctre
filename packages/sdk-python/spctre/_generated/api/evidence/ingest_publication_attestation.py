from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.publication_attestation_ingest_request import (
    PublicationAttestationIngestRequest,
)
from ...models.publication_attestation_ingest_response import (
    PublicationAttestationIngestResponse,
)
from ...types import Response


def _get_kwargs(
    *,
    body: PublicationAttestationIngestRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/evidence/publications",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | PublicationAttestationIngestResponse | None:
    if response.status_code == 200:
        response_200 = PublicationAttestationIngestResponse.from_dict(response.json())

        return response_200

    if response.status_code == 201:
        response_201 = PublicationAttestationIngestResponse.from_dict(response.json())

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

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ApiError | PublicationAttestationIngestResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: PublicationAttestationIngestRequest,
) -> Response[ApiError | PublicationAttestationIngestResponse]:
    """Ingest immutable publication facts

     Accepts normalized publication facts bound to a retained artifact. The server validates shape,
    artifact binding, authorization, idempotency, and optional receipt signatures; it does not
    adjudicate legal compliance.

    Args:
        body (PublicationAttestationIngestRequest): Framework-agnostic publication facts. Clients
            submit normalized facts bound to a previously retained byte-exact artifact; the server
            never fetches a URL, renders a page, or adjudicates compliance.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | PublicationAttestationIngestResponse]
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
    body: PublicationAttestationIngestRequest,
) -> ApiError | PublicationAttestationIngestResponse | None:
    """Ingest immutable publication facts

     Accepts normalized publication facts bound to a retained artifact. The server validates shape,
    artifact binding, authorization, idempotency, and optional receipt signatures; it does not
    adjudicate legal compliance.

    Args:
        body (PublicationAttestationIngestRequest): Framework-agnostic publication facts. Clients
            submit normalized facts bound to a previously retained byte-exact artifact; the server
            never fetches a URL, renders a page, or adjudicates compliance.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | PublicationAttestationIngestResponse
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PublicationAttestationIngestRequest,
) -> Response[ApiError | PublicationAttestationIngestResponse]:
    """Ingest immutable publication facts

     Accepts normalized publication facts bound to a retained artifact. The server validates shape,
    artifact binding, authorization, idempotency, and optional receipt signatures; it does not
    adjudicate legal compliance.

    Args:
        body (PublicationAttestationIngestRequest): Framework-agnostic publication facts. Clients
            submit normalized facts bound to a previously retained byte-exact artifact; the server
            never fetches a URL, renders a page, or adjudicates compliance.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | PublicationAttestationIngestResponse]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PublicationAttestationIngestRequest,
) -> ApiError | PublicationAttestationIngestResponse | None:
    """Ingest immutable publication facts

     Accepts normalized publication facts bound to a retained artifact. The server validates shape,
    artifact binding, authorization, idempotency, and optional receipt signatures; it does not
    adjudicate legal compliance.

    Args:
        body (PublicationAttestationIngestRequest): Framework-agnostic publication facts. Clients
            submit normalized facts bound to a previously retained byte-exact artifact; the server
            never fetches a URL, renders a page, or adjudicates compliance.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | PublicationAttestationIngestResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
