import datetime
from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.forensic_evidence_query_response_200 import (
    ForensicEvidenceQueryResponse200,
)
from ...models.forensic_evidence_query_response_402 import (
    ForensicEvidenceQueryResponse402,
)
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    from_: datetime.datetime | Unset = UNSET,
    to: datetime.datetime | Unset = UNSET,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 1000,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_from_: str | Unset = UNSET
    if not isinstance(from_, Unset):
        json_from_ = from_.isoformat()
    params["from"] = json_from_

    json_to: str | Unset = UNSET
    if not isinstance(to, Unset):
        json_to = to.isoformat()
    params["to"] = json_to

    params["cursor"] = cursor

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/evidence/forensic",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    ApiError
    | ForensicEvidenceQueryResponse200
    | ForensicEvidenceQueryResponse402
    | None
):
    if response.status_code == 200:
        response_200 = ForensicEvidenceQueryResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = ApiError.from_dict(response.json())

        return response_401

    if response.status_code == 402:
        response_402 = ForensicEvidenceQueryResponse402.from_dict(response.json())

        return response_402

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    ApiError | ForensicEvidenceQueryResponse200 | ForensicEvidenceQueryResponse402
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    from_: datetime.datetime | Unset = UNSET,
    to: datetime.datetime | Unset = UNSET,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 1000,
) -> Response[
    ApiError | ForensicEvidenceQueryResponse200 | ForensicEvidenceQueryResponse402
]:
    """Forensic archival evidence query

     Query the full tenant event log for forensic replay and archival analysis. Returns up to 10,000
    records per request with cursor-based pagination.

    Args:
        from_ (datetime.datetime | Unset):
        to (datetime.datetime | Unset):
        cursor (str | Unset):
        limit (int | Unset):  Default: 1000.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | ForensicEvidenceQueryResponse200 | ForensicEvidenceQueryResponse402]
    """

    kwargs = _get_kwargs(
        from_=from_,
        to=to,
        cursor=cursor,
        limit=limit,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    from_: datetime.datetime | Unset = UNSET,
    to: datetime.datetime | Unset = UNSET,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 1000,
) -> (
    ApiError
    | ForensicEvidenceQueryResponse200
    | ForensicEvidenceQueryResponse402
    | None
):
    """Forensic archival evidence query

     Query the full tenant event log for forensic replay and archival analysis. Returns up to 10,000
    records per request with cursor-based pagination.

    Args:
        from_ (datetime.datetime | Unset):
        to (datetime.datetime | Unset):
        cursor (str | Unset):
        limit (int | Unset):  Default: 1000.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | ForensicEvidenceQueryResponse200 | ForensicEvidenceQueryResponse402
    """

    return sync_detailed(
        client=client,
        from_=from_,
        to=to,
        cursor=cursor,
        limit=limit,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    from_: datetime.datetime | Unset = UNSET,
    to: datetime.datetime | Unset = UNSET,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 1000,
) -> Response[
    ApiError | ForensicEvidenceQueryResponse200 | ForensicEvidenceQueryResponse402
]:
    """Forensic archival evidence query

     Query the full tenant event log for forensic replay and archival analysis. Returns up to 10,000
    records per request with cursor-based pagination.

    Args:
        from_ (datetime.datetime | Unset):
        to (datetime.datetime | Unset):
        cursor (str | Unset):
        limit (int | Unset):  Default: 1000.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | ForensicEvidenceQueryResponse200 | ForensicEvidenceQueryResponse402]
    """

    kwargs = _get_kwargs(
        from_=from_,
        to=to,
        cursor=cursor,
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    from_: datetime.datetime | Unset = UNSET,
    to: datetime.datetime | Unset = UNSET,
    cursor: str | Unset = UNSET,
    limit: int | Unset = 1000,
) -> (
    ApiError
    | ForensicEvidenceQueryResponse200
    | ForensicEvidenceQueryResponse402
    | None
):
    """Forensic archival evidence query

     Query the full tenant event log for forensic replay and archival analysis. Returns up to 10,000
    records per request with cursor-based pagination.

    Args:
        from_ (datetime.datetime | Unset):
        to (datetime.datetime | Unset):
        cursor (str | Unset):
        limit (int | Unset):  Default: 1000.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | ForensicEvidenceQueryResponse200 | ForensicEvidenceQueryResponse402
    """

    return (
        await asyncio_detailed(
            client=client,
            from_=from_,
            to=to,
            cursor=cursor,
            limit=limit,
        )
    ).parsed
