from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.evaluate_trust_governance_response_200 import (
    EvaluateTrustGovernanceResponse200,
)
from ...models.trust_evaluate_request import TrustEvaluateRequest
from ...types import Response


def _get_kwargs(
    *,
    body: TrustEvaluateRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/trust/evaluate",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | EvaluateTrustGovernanceResponse200 | None:
    if response.status_code == 200:
        response_200 = EvaluateTrustGovernanceResponse200.from_dict(response.json())

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
) -> Response[ApiError | EvaluateTrustGovernanceResponse200]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: TrustEvaluateRequest,
) -> Response[ApiError | EvaluateTrustGovernanceResponse200]:
    """Evaluate trust and context-budget governance

     Evaluates trust score and context-token state against enabled calibration policies, returning an
    ALLOW/WARN/REVIEW/ESCALATE action plus a gateway risk hint.

    Args:
        body (TrustEvaluateRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | EvaluateTrustGovernanceResponse200]
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
    body: TrustEvaluateRequest,
) -> ApiError | EvaluateTrustGovernanceResponse200 | None:
    """Evaluate trust and context-budget governance

     Evaluates trust score and context-token state against enabled calibration policies, returning an
    ALLOW/WARN/REVIEW/ESCALATE action plus a gateway risk hint.

    Args:
        body (TrustEvaluateRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | EvaluateTrustGovernanceResponse200
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: TrustEvaluateRequest,
) -> Response[ApiError | EvaluateTrustGovernanceResponse200]:
    """Evaluate trust and context-budget governance

     Evaluates trust score and context-token state against enabled calibration policies, returning an
    ALLOW/WARN/REVIEW/ESCALATE action plus a gateway risk hint.

    Args:
        body (TrustEvaluateRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | EvaluateTrustGovernanceResponse200]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: TrustEvaluateRequest,
) -> ApiError | EvaluateTrustGovernanceResponse200 | None:
    """Evaluate trust and context-budget governance

     Evaluates trust score and context-token state against enabled calibration policies, returning an
    ALLOW/WARN/REVIEW/ESCALATE action plus a gateway risk hint.

    Args:
        body (TrustEvaluateRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | EvaluateTrustGovernanceResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
