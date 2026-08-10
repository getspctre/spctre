from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.api_error import ApiError
from ...models.bundle_export_blocked_response import BundleExportBlockedResponse
from ...models.bundle_export_envelope import BundleExportEnvelope
from ...models.bundle_export_format import BundleExportFormat
from ...models.bundle_export_preview_response import BundleExportPreviewResponse
from ...models.bundle_export_verification_failed_response import (
    BundleExportVerificationFailedResponse,
)
from ...models.bundle_response import BundleResponse
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    format_: BundleExportFormat | Unset = UNSET,
    preview: bool | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_format_: str | Unset = UNSET
    if not isinstance(format_, Unset):
        json_format_ = format_.value

    params["format"] = json_format_

    params["preview"] = preview

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/bundle/latest",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    ApiError
    | BundleExportBlockedResponse
    | BundleExportEnvelope
    | BundleExportPreviewResponse
    | BundleResponse
    | BundleExportVerificationFailedResponse
    | None
):
    if response.status_code == 200:

        def _parse_response_200(
            data: object,
        ) -> BundleExportEnvelope | BundleExportPreviewResponse | BundleResponse:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_200_type_0 = BundleResponse.from_dict(data)

                return response_200_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_200_type_1 = BundleExportEnvelope.from_dict(data)

                return response_200_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            response_200_type_2 = BundleExportPreviewResponse.from_dict(data)

            return response_200_type_2

        response_200 = _parse_response_200(response.json())

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

    if response.status_code == 409:
        response_409 = BundleExportBlockedResponse.from_dict(response.json())

        return response_409

    if response.status_code == 500:
        response_500 = BundleExportVerificationFailedResponse.from_dict(response.json())

        return response_500

    if response.status_code == 503:
        response_503 = ApiError.from_dict(response.json())

        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    ApiError
    | BundleExportBlockedResponse
    | BundleExportEnvelope
    | BundleExportPreviewResponse
    | BundleResponse
    | BundleExportVerificationFailedResponse
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
    format_: BundleExportFormat | Unset = UNSET,
    preview: bool | Unset = UNSET,
) -> Response[
    ApiError
    | BundleExportBlockedResponse
    | BundleExportEnvelope
    | BundleExportPreviewResponse
    | BundleResponse
    | BundleExportVerificationFailedResponse
]:
    """Download the latest published policy bundle

     Returns the latest published policy bundle for the authenticated workspace. Without `format`, the
    response is the raw AGT-compatible JSON bundle. `x-spctre-policy-content-hash` is SHA-256 over those
    exact JSON bytes, distinct from the semantic artifact hash. With `format`, the response is an export
    envelope containing a target artifact and manifest. Use `preview=true` with no format to inspect all
    target manifests without downloading artifacts.

    Args:
        format_ (BundleExportFormat | Unset):
        preview (bool | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | BundleExportBlockedResponse | BundleExportEnvelope | BundleExportPreviewResponse | BundleResponse | BundleExportVerificationFailedResponse]
    """

    kwargs = _get_kwargs(
        format_=format_,
        preview=preview,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    format_: BundleExportFormat | Unset = UNSET,
    preview: bool | Unset = UNSET,
) -> (
    ApiError
    | BundleExportBlockedResponse
    | BundleExportEnvelope
    | BundleExportPreviewResponse
    | BundleResponse
    | BundleExportVerificationFailedResponse
    | None
):
    """Download the latest published policy bundle

     Returns the latest published policy bundle for the authenticated workspace. Without `format`, the
    response is the raw AGT-compatible JSON bundle. `x-spctre-policy-content-hash` is SHA-256 over those
    exact JSON bytes, distinct from the semantic artifact hash. With `format`, the response is an export
    envelope containing a target artifact and manifest. Use `preview=true` with no format to inspect all
    target manifests without downloading artifacts.

    Args:
        format_ (BundleExportFormat | Unset):
        preview (bool | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | BundleExportBlockedResponse | BundleExportEnvelope | BundleExportPreviewResponse | BundleResponse | BundleExportVerificationFailedResponse
    """

    return sync_detailed(
        client=client,
        format_=format_,
        preview=preview,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    format_: BundleExportFormat | Unset = UNSET,
    preview: bool | Unset = UNSET,
) -> Response[
    ApiError
    | BundleExportBlockedResponse
    | BundleExportEnvelope
    | BundleExportPreviewResponse
    | BundleResponse
    | BundleExportVerificationFailedResponse
]:
    """Download the latest published policy bundle

     Returns the latest published policy bundle for the authenticated workspace. Without `format`, the
    response is the raw AGT-compatible JSON bundle. `x-spctre-policy-content-hash` is SHA-256 over those
    exact JSON bytes, distinct from the semantic artifact hash. With `format`, the response is an export
    envelope containing a target artifact and manifest. Use `preview=true` with no format to inspect all
    target manifests without downloading artifacts.

    Args:
        format_ (BundleExportFormat | Unset):
        preview (bool | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | BundleExportBlockedResponse | BundleExportEnvelope | BundleExportPreviewResponse | BundleResponse | BundleExportVerificationFailedResponse]
    """

    kwargs = _get_kwargs(
        format_=format_,
        preview=preview,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    format_: BundleExportFormat | Unset = UNSET,
    preview: bool | Unset = UNSET,
) -> (
    ApiError
    | BundleExportBlockedResponse
    | BundleExportEnvelope
    | BundleExportPreviewResponse
    | BundleResponse
    | BundleExportVerificationFailedResponse
    | None
):
    """Download the latest published policy bundle

     Returns the latest published policy bundle for the authenticated workspace. Without `format`, the
    response is the raw AGT-compatible JSON bundle. `x-spctre-policy-content-hash` is SHA-256 over those
    exact JSON bytes, distinct from the semantic artifact hash. With `format`, the response is an export
    envelope containing a target artifact and manifest. Use `preview=true` with no format to inspect all
    target manifests without downloading artifacts.

    Args:
        format_ (BundleExportFormat | Unset):
        preview (bool | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | BundleExportBlockedResponse | BundleExportEnvelope | BundleExportPreviewResponse | BundleResponse | BundleExportVerificationFailedResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            format_=format_,
            preview=preview,
        )
    ).parsed
