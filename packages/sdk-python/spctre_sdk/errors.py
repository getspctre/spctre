"""Errors raised by the supported facade.

The generated client raises `spctre.exceptions.ApiException` and its
status-specific subclasses, plus bare urllib3 errors for transport failures.
Callers of this facade should never have to import from `spctre.exceptions` or
branch on HTTP status codes, so every failure is normalized into the hierarchy
below.
"""

from __future__ import annotations

import json
from typing import Any, Optional

__all__ = [
    "SpctreError",
    "SpctreAuthError",
    "SpctrePermissionError",
    "SpctreRequestError",
    "SpctreResponseError",
    "SpctreServerError",
    "SpctreTransportError",
]


class SpctreError(Exception):
    """Base class for every error raised by the facade.

    `trace_id` is lifted out of the API's response envelope when present. Every
    control-plane response carries `meta.traceId`, and quoting it is the fastest
    way to correlate a client-side failure with server-side logs.
    """

    def __init__(
        self,
        message: str,
        *,
        status: Optional[int] = None,
        trace_id: Optional[str] = None,
        body: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.trace_id = trace_id
        self.body = body

    def __str__(self) -> str:
        parts = [self.message]
        if self.status is not None:
            parts.append(f"status={self.status}")
        if self.trace_id:
            parts.append(f"traceId={self.trace_id}")
        return " ".join(parts)


class SpctreAuthError(SpctreError):
    """401 — the token is missing, malformed, expired, or revoked."""


class SpctrePermissionError(SpctreError):
    """403 — the token is valid but lacks the scope for this operation."""


class SpctreRequestError(SpctreError):
    """4xx other than 401/403 — the request itself was rejected."""


class SpctreServerError(SpctreError):
    """5xx — the control plane failed to handle an otherwise valid request."""


class SpctreTransportError(SpctreError):
    """The request never produced an HTTP response (DNS, TLS, timeout, ...)."""


class SpctreResponseError(SpctreError):
    """The control plane answered, but the response could not be interpreted.

    Distinct from `SpctreTransportError` on purpose: reporting a schema
    mismatch as an unreachable host sends debugging in entirely the wrong
    direction. In practice this means the client and the deployment disagree
    about the API contract — usually an SDK too old or too new for the server.
    """


def _extract_trace_id(body: Optional[str]) -> Optional[str]:
    """Best-effort lift of `meta.traceId` from an error envelope.

    Error bodies are not guaranteed to be JSON — a proxy or load balancer can
    return HTML — so this never raises.
    """
    if not body:
        return None
    try:
        payload: Any = json.loads(body)
    except (ValueError, TypeError):
        return None
    if not isinstance(payload, dict):
        return None
    meta = payload.get("meta")
    if isinstance(meta, dict):
        trace_id = meta.get("traceId")
        if isinstance(trace_id, str):
            return trace_id
    return None


def _message_for(status: Optional[int], body: Optional[str]) -> str:
    """Prefer the API's own error message over a generic status description."""
    if body:
        try:
            payload = json.loads(body)
        except (ValueError, TypeError):
            payload = None
        if isinstance(payload, dict):
            for key in ("message", "error", "detail"):
                value = payload.get(key)
                if isinstance(value, str) and value:
                    return value
                if isinstance(value, dict):
                    nested = value.get("message")
                    if isinstance(nested, str) and nested:
                        return nested
    if status is None:
        return "Spctre request failed"
    return f"Spctre request failed with HTTP {status}"


def translate_api_exception(exc: Exception) -> SpctreError:
    """Map a generated-client exception onto the facade's hierarchy.

    Imported lazily so that this module stays importable even if the generated
    package is absent — which is the case when working in the source tree
    before `pnpm generate:python-sdk` has run.
    """
    try:
        from spctre.exceptions import ApiException
    except ImportError:  # pragma: no cover - generated package always present when installed
        ApiException = ()  # type: ignore[assignment]

    if ApiException and isinstance(exc, ApiException):  # type: ignore[arg-type]
        status = getattr(exc, "status", None)
        body = getattr(exc, "body", None)
        if isinstance(body, bytes):
            body = body.decode("utf-8", errors="replace")
        trace_id = _extract_trace_id(body)
        message = _message_for(status, body)
        kwargs = {"status": status, "trace_id": trace_id, "body": body}

        if status == 401:
            return SpctreAuthError(message, **kwargs)
        if status == 403:
            return SpctrePermissionError(message, **kwargs)
        if isinstance(status, int) and 400 <= status < 500:
            return SpctreRequestError(message, **kwargs)
        if isinstance(status, int) and status >= 500:
            return SpctreServerError(message, **kwargs)
        return SpctreError(message, **kwargs)

    # A response arrived but did not match the schema the client was generated
    # from. Reported separately so this does not masquerade as a network fault.
    try:
        from pydantic import ValidationError
    except ImportError:  # pragma: no cover - pydantic is a hard dependency
        ValidationError = ()  # type: ignore[assignment]

    if ValidationError and isinstance(exc, ValidationError):  # type: ignore[arg-type]
        return SpctreResponseError(
            "The Spctre control plane returned a response this SDK could not parse. "
            f"The client and the deployment may be on different API versions: {exc}"
        )

    # Anything that never reached an HTTP response: urllib3 connection and
    # timeout errors, and the generated client's non-HTTP OpenApiException
    # subclasses.
    return SpctreTransportError(f"Could not reach the Spctre control plane: {exc}")
