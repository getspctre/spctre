"""The supported Spctre client facade.

Deliberately narrow. It covers the operations a governed agent needs on its
hot path — ask the gateway for a decision, then write the evidence — and
nothing else. Anything outside that scope is reached through the generated
package directly:

    from spctre.api.compliance_api import ComplianceApi

The facade owns three things the generated client leaves to the caller: the
`/api/v1` base path, bearer authentication, and error normalization.
"""

from __future__ import annotations

from types import TracebackType
from typing import TYPE_CHECKING, Any, Optional, Protocol, Type, cast

from ._url import normalize_base_url
from ._version import __version__
from .errors import translate_api_exception

if TYPE_CHECKING:  # pragma: no cover - import cycle only matters to type checkers
    from spctre.models.evidence_ingest_request import EvidenceIngestRequest
    from spctre.models.gateway_decision_request import GatewayDecisionRequest
    from spctre.models.gateway_decision_response import GatewayDecisionResponse
    from spctre.rest import RESTClientObject

__all__ = ["SpctreClient", "Transport"]

DEFAULT_TIMEOUT_SECONDS = 30.0


class Transport(Protocol):
    """The seam the generated client uses to perform HTTP.

    Supplying one replaces urllib3 entirely, which is how tests avoid real
    network access. The signature mirrors the generated `RESTClientObject`,
    and an implementation must return an object exposing `status`, `data` and
    `getheaders()`.
    """

    def request(
        self,
        method: str,
        url: str,
        headers: Optional[dict] = None,
        body: Optional[Any] = None,
        post_params: Optional[list] = None,
        _request_timeout: Optional[Any] = None,
    ) -> Any: ...


class _GatewayNamespace:
    """Gateway operations: ask before acting."""

    def __init__(self, client: "SpctreClient") -> None:
        self._client = client

    def decide(
        self,
        request: "GatewayDecisionRequest",
        *,
        timeout: Optional[float] = None,
    ) -> "GatewayDecisionResponse":
        """Evaluate a proposed action against published policy.

        Raises a `SpctreError` subclass on failure — never a generated
        `ApiException`.
        """
        from spctre.api.gateway_api import GatewayApi

        api = GatewayApi(self._client._api_client)
        with self._client._translating_errors():
            return api.gateway_decide(
                request,
                _request_timeout=timeout if timeout is not None else self._client._timeout,
            )


class _EvidenceNamespace:
    """Evidence operations: record what happened."""

    def __init__(self, client: "SpctreClient") -> None:
        self._client = client

    def ingest(
        self,
        request: "EvidenceIngestRequest",
        *,
        timeout: Optional[float] = None,
    ) -> Any:
        """Write a runtime evidence record.

        Raises a `SpctreError` subclass on failure — never a generated
        `ApiException`.
        """
        from spctre.api.evidence_api import EvidenceApi

        api = EvidenceApi(self._client._api_client)
        with self._client._translating_errors():
            return api.ingest_evidence(
                request,
                _request_timeout=timeout if timeout is not None else self._client._timeout,
            )


class SpctreClient:
    """A configured, authenticated client for one Spctre deployment.

        client = SpctreClient(
            base_url="https://app-staging.spctre.dev",
            token=token,
        )
        decision = client.gateway.decide(request)
        client.evidence.ingest(record)

    `base_url` is the deployment origin, not the API root — staging, production
    and self-hosted deployments differ only in this value. See
    `spctre_sdk._url.normalize_base_url` for the accepted forms.

    Usable as a context manager, which closes the underlying connection pool.
    """

    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        transport: Optional[Transport] = None,
        timeout: Optional[float] = DEFAULT_TIMEOUT_SECONDS,
        user_agent: Optional[str] = None,
    ) -> None:
        if not isinstance(token, str) or not token.strip():
            raise ValueError("token must be a non-empty string")

        from spctre.api_client import ApiClient
        from spctre.configuration import Configuration

        self.base_url = normalize_base_url(base_url)
        self._timeout = timeout

        configuration = Configuration(host=self.base_url, access_token=token.strip())
        self._api_client = ApiClient(configuration)
        self._api_client.user_agent = user_agent or f"spctre-sdk-python/{__version__}"

        # The generated ApiClient builds its own urllib3-backed rest_client in
        # __init__; replacing the attribute is the documented seam for
        # substituting one.
        if transport is not None:
            # The generated attribute is typed as the concrete RESTClientObject,
            # but only its `request` method is ever called. `Transport` states
            # that contract; the cast is the price of the generated annotation.
            self._api_client.rest_client = cast("RESTClientObject", transport)

        self.gateway = _GatewayNamespace(self)
        self.evidence = _EvidenceNamespace(self)

    def _translating_errors(self):
        return _ErrorTranslator()

    def close(self) -> None:
        """Release the underlying connection pool."""
        close = getattr(self._api_client, "close", None)
        if callable(close):
            close()

    def __enter__(self) -> "SpctreClient":
        return self

    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        self.close()

    def __repr__(self) -> str:
        # Never render the token.
        return f"SpctreClient(base_url={self.base_url!r})"


class _ErrorTranslator:
    """Context manager that rewrites generated exceptions on the way out."""

    def __enter__(self) -> "_ErrorTranslator":
        return self

    # Returns None rather than bool: this never suppresses, and declaring it
    # as possibly-suppressing makes every caller look like it can fall through
    # without returning a value.
    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        if isinstance(exc, Exception):
            raise translate_api_exception(exc) from exc
