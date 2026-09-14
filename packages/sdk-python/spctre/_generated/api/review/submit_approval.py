from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.approval_decision_request import ApprovalDecisionRequest
from ...models.approval_decision_response import ApprovalDecisionResponse
from ...types import Response


def _get_kwargs(
    *,
    body: ApprovalDecisionRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/approvals",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> ApiError | ApprovalDecisionResponse | None:
    if response.status_code == 200:
        response_200 = ApprovalDecisionResponse.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = ApiError.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ApiError.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = ApiError.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = ApiError.from_dict(response.json())

        return response_404

    if response.status_code == 422:
        response_422 = ApiError.from_dict(response.json())

        return response_422

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[ApiError | ApprovalDecisionResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: ApprovalDecisionRequest,
) -> Response[ApiError | ApprovalDecisionResponse]:
    """Submit a review decision for a policy revision

     Records an approval or a change request against a policy revision, as the principal the token was
    issued to. Requires the `approvals:write` scope, which is admin-issuable only and never granted to
    runtime agent tokens — so a governed agent can never approve the policy that governs it. There is no
    actor field: the reviewer is read from the token, so a key can only review in the roles its own
    principal holds. An approval is unique per (revision, reviewer), so a workflow requiring two roles
    requires two keys held by two reviewers — the same rule the review console applies. 422 means the
    revision exists but the review state refused the decision, including when the principal holds no
    grant in the workspace.

    Args:
        body (ApprovalDecisionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | ApprovalDecisionResponse]
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
    body: ApprovalDecisionRequest,
) -> ApiError | ApprovalDecisionResponse | None:
    """Submit a review decision for a policy revision

     Records an approval or a change request against a policy revision, as the principal the token was
    issued to. Requires the `approvals:write` scope, which is admin-issuable only and never granted to
    runtime agent tokens — so a governed agent can never approve the policy that governs it. There is no
    actor field: the reviewer is read from the token, so a key can only review in the roles its own
    principal holds. An approval is unique per (revision, reviewer), so a workflow requiring two roles
    requires two keys held by two reviewers — the same rule the review console applies. 422 means the
    revision exists but the review state refused the decision, including when the principal holds no
    grant in the workspace.

    Args:
        body (ApprovalDecisionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | ApprovalDecisionResponse
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: ApprovalDecisionRequest,
) -> Response[ApiError | ApprovalDecisionResponse]:
    """Submit a review decision for a policy revision

     Records an approval or a change request against a policy revision, as the principal the token was
    issued to. Requires the `approvals:write` scope, which is admin-issuable only and never granted to
    runtime agent tokens — so a governed agent can never approve the policy that governs it. There is no
    actor field: the reviewer is read from the token, so a key can only review in the roles its own
    principal holds. An approval is unique per (revision, reviewer), so a workflow requiring two roles
    requires two keys held by two reviewers — the same rule the review console applies. 422 means the
    revision exists but the review state refused the decision, including when the principal holds no
    grant in the workspace.

    Args:
        body (ApprovalDecisionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | ApprovalDecisionResponse]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: ApprovalDecisionRequest,
) -> ApiError | ApprovalDecisionResponse | None:
    """Submit a review decision for a policy revision

     Records an approval or a change request against a policy revision, as the principal the token was
    issued to. Requires the `approvals:write` scope, which is admin-issuable only and never granted to
    runtime agent tokens — so a governed agent can never approve the policy that governs it. There is no
    actor field: the reviewer is read from the token, so a key can only review in the roles its own
    principal holds. An approval is unique per (revision, reviewer), so a workflow requiring two roles
    requires two keys held by two reviewers — the same rule the review console applies. 422 means the
    revision exists but the review state refused the decision, including when the principal holds no
    grant in the workspace.

    Args:
        body (ApprovalDecisionRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | ApprovalDecisionResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
