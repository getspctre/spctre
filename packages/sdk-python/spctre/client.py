"""The supported Spctre client facade.

Organized by product domain, following the control-plane loop: policy changes
become published controls, controls produce enforced decisions, decisions
produce evidence, evidence supports assurance.

The facade owns four things the generated layer leaves to the caller: the
`/api/v1` base path, bearer authentication, error normalization, and a surface
that does not move when the generator does. Operations outside these domains
remain reachable through `spctre._generated`, which is regenerated wholesale
and carries no such stability promise.
"""

from __future__ import annotations

import datetime
from types import TracebackType
from typing import Any, Callable, Optional, Type, TypeVar

import httpx

from ._generated.api.approvals import get_approval
from ._generated.api.bundle import get_bundle_latest, retain_latest_published_bundle
from ._generated.api.compliance import export_compliance
from ._generated.api.evidence import (
    forensic_evidence_query,
    ingest_evidence,
    ingest_git_checkpoint,
)
from ._generated.api.gateway import (
    gateway_decide,
    gateway_resolve,
    get_escalation_status,
    list_escalations,
    register_agt_escalation_request,
)
from ._generated.api.policy import import_policy
from ._generated.api.trust import (
    evaluate_trust_governance,
    ingest_context_budget_event,
    ingest_trust_score,
)
from ._generated.api.verification import ingest_verification, list_verifications
from ._generated.client import AuthenticatedClient
from ._generated.types import UNSET, Unset
from ._url import normalize_base_url
from ._version import __version__
from .errors import SpctreResponseError, error_for_status, transport_error

__all__ = ["SpctreClient", "UNSET", "Unset"]

DEFAULT_TIMEOUT_SECONDS = 30.0

T = TypeVar("T")


class _Domain:
    def __init__(self, client: "SpctreClient") -> None:
        self._c = client


class _Gateway(_Domain):
    """Ask before acting, and resolve what was escalated."""

    def decide(self, body: Any) -> Any:
        """Evaluate a proposed action against published policy."""
        return self._c._call(gateway_decide, body=body)

    def resolve(self, body: Any) -> Any:
        """Record the resolution of an escalated decision."""
        return self._c._call(gateway_resolve, body=body)

    def escalation_status(self, decision_id: str) -> Any:
        """Look up where one escalated decision currently stands."""
        return self._c._call(get_escalation_status, decision_id=decision_id)

    def list_escalations(self, *, limit: int | Unset = 50) -> Any:
        """List outstanding escalations."""
        return self._c._call(list_escalations, limit=limit)

    def register_agt_escalation(self, body: Any) -> Any:
        """Register an AGT-originated escalation request."""
        return self._c._call(register_agt_escalation_request, body=body)


class _Evidence(_Domain):
    """Record what happened, durably."""

    def ingest(self, body: Any) -> Any:
        """Write a runtime evidence record."""
        return self._c._call(ingest_evidence, body=body)

    def ingest_git_checkpoint(self, body: Any) -> Any:
        """Write a git checkpoint evidence record."""
        return self._c._call(ingest_git_checkpoint, body=body)

    def forensic_query(
        self,
        *,
        from_: datetime.datetime | Unset = UNSET,
        to: datetime.datetime | Unset = UNSET,
        cursor: str | Unset = UNSET,
        limit: int | Unset = 1000,
    ) -> Any:
        """Page through retained evidence for investigation."""
        return self._c._call(
            forensic_evidence_query,
            from_=from_,
            to=to,
            cursor=cursor,
            limit=limit,
        )


class _Policy(_Domain):
    """Author and land policy changes."""

    def import_policy(self, body: Any) -> Any:
        """Idempotently import policy source as a draft. Never publishes."""
        return self._c._call(import_policy, body=body)


class _Trust(_Domain):
    """Trust and economic governance signals."""

    def ingest_score(self, body: Any) -> Any:
        """Record a trust score observation."""
        return self._c._call(ingest_trust_score, body=body)

    def evaluate(self, body: Any) -> Any:
        """Evaluate trust governance for a proposed action."""
        return self._c._call(evaluate_trust_governance, body=body)

    def ingest_context_budget(self, body: Any) -> Any:
        """Record a context-budget consumption event."""
        return self._c._call(ingest_context_budget_event, body=body)


class _Verification(_Domain):
    """Assurance over what was enforced."""

    def ingest(self, body: Any) -> Any:
        """Record a verification result."""
        return self._c._call(ingest_verification, body=body)

    def list(
        self,
        *,
        revision_id: str | Unset = UNSET,
        artifact_hash: str | Unset = UNSET,
        limit: int | Unset = 50,
    ) -> Any:
        """List verification results."""
        return self._c._call(
            list_verifications,
            revision_id=revision_id,
            artifact_hash=artifact_hash,
            limit=limit,
        )


class _Bundle(_Domain):
    """The published runtime control bundle."""

    def latest(self, *, format_: Any = UNSET, preview: bool | Unset = UNSET) -> Any:
        """Fetch the latest published bundle."""
        return self._c._call(get_bundle_latest, format_=format_, preview=preview)

    def retain_latest(self, body: Any) -> Any:
        """Take custody of the latest published bundle."""
        return self._c._call(retain_latest_published_bundle, body=body)


class _Compliance(_Domain):
    """Evidence shaped for auditors."""

    def export(self, *, framework: Any = UNSET, format_: Any = UNSET) -> Any:
        """Export a compliance report."""
        return self._c._call(export_compliance, framework=framework, format_=format_)


class _Approvals(_Domain):
    """Human review outcomes."""

    def get(self, approval_id: str) -> Any:
        """Fetch one approval by id."""
        return self._c._call(get_approval, approval_id)


class SpctreClient:
    """A configured, authenticated client for one Spctre deployment.

        client = SpctreClient(
            base_url="https://app-staging.spctre.dev",
            token=token,
        )
        decision = client.gateway.decide(request)
        client.evidence.ingest(record)

    `base_url` is the deployment origin, not the API root — staging, production
    and self-hosted deployments differ only in this value.

    `transport` accepts any `httpx.BaseTransport`, which is how tests avoid
    real network access:

        client = SpctreClient(..., transport=httpx.MockTransport(handler))

    Usable as a context manager, which closes the underlying connection pool.
    """

    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        transport: Optional[httpx.BaseTransport] = None,
        timeout: Optional[float] = DEFAULT_TIMEOUT_SECONDS,
        user_agent: Optional[str] = None,
        verify_ssl: bool = True,
    ) -> None:
        if not isinstance(token, str) or not token.strip():
            raise ValueError("token must be a non-empty string")

        self.base_url = normalize_base_url(base_url)

        # Headers go through the client's own `headers` field, not httpx_args:
        # the generated client already forwards _headers to httpx.Client, so
        # passing them again would collide on the same keyword.
        httpx_args: dict[str, Any] = {}
        if transport is not None:
            httpx_args["transport"] = transport

        self._client = AuthenticatedClient(
            base_url=self.base_url,
            token=token.strip(),
            headers={"User-Agent": user_agent or f"spctre-sdk-python/{__version__}"},
            timeout=httpx.Timeout(timeout) if timeout is not None else None,
            verify_ssl=verify_ssl,
            httpx_args=httpx_args,
        )

        self.gateway = _Gateway(self)
        self.evidence = _Evidence(self)
        self.policy = _Policy(self)
        self.trust = _Trust(self)
        self.verification = _Verification(self)
        self.bundle = _Bundle(self)
        self.compliance = _Compliance(self)
        self.approvals = _Approvals(self)

    def _call(self, endpoint: Any, *args: Any, **kwargs: Any) -> Any:
        """Invoke a generated endpoint and normalize its failure modes.

        This drives the endpoint module's `_get_kwargs` / `_parse_response`
        rather than its `sync_detailed`, because `sync_detailed` deserializes
        before the caller can look at the status. That ordering is a problem in
        practice: an error status whose body is not the documented error schema
        — proxy HTML on a 502, an auth gateway's own 401 page — raises a raw
        JSONDecodeError out of the generated layer instead of the corresponding
        SpctreError.

        Checking the status first means a failed request always produces the
        right error type, and deserialization problems are confined to
        responses that actually claimed success.

        The two module-level functions are private to the generator, so this
        depends on a generator internal. That dependency is deliberate and
        contained: the generator version is pinned, the generated tree is
        checked in, and the sync check fails on any regeneration diff — so a
        change to these internals surfaces as a reviewable diff plus failing
        tests rather than a silent runtime break.
        """
        try:
            request_kwargs = endpoint._get_kwargs(*args, **kwargs)
            response = self._client.get_httpx_client().request(**request_kwargs)
        except httpx.HTTPError as exc:
            raise transport_error(exc) from exc

        status = int(response.status_code)
        if not (200 <= status < 300):
            raise error_for_status(status, response.content)

        if status == 204 or not response.content:
            return None

        try:
            return endpoint._parse_response(client=self._client, response=response)
        except Exception as exc:
            raise SpctreResponseError(
                "The Spctre control plane returned a response this SDK could not parse. "
                f"The client and the deployment may be on different API versions: {exc}",
                status=status,
                body=response.content.decode("utf-8", errors="replace"),
            ) from exc

    def close(self) -> None:
        """Release the underlying connection pool."""
        self._client.get_httpx_client().close()

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
