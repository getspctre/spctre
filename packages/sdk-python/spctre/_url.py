"""Base-URL normalization.

Kept separate from `client` so it can be exercised on its own.
"""

from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit

API_PREFIX = "/api/v1"

__all__ = ["API_PREFIX", "normalize_base_url"]


def normalize_base_url(base_url: str) -> str:
    """Turn a deployment URL into the versioned API root.

    The facade owns the `/api/v1` path segment so callers configure a
    deployment, not an API version:

        https://app-staging.spctre.dev   -> https://app-staging.spctre.dev/api/v1
        https://app.example.com/         -> https://app.example.com/api/v1

    A non-empty path is preserved as a mount prefix, so a control plane served
    under a sub-path behind a reverse proxy works without special casing:

        https://internal.example.com/spctre -> https://internal.example.com/spctre/api/v1

    Passing a URL that already ends in the prefix is accepted unchanged rather
    than doubled, so round-tripping `client.base_url` back into the constructor
    is safe.
    """
    if not isinstance(base_url, str) or not base_url.strip():
        raise ValueError("base_url must be a non-empty string")

    parts = urlsplit(base_url.strip())

    if parts.scheme not in ("http", "https"):
        raise ValueError(
            f"base_url must be an absolute http(s) URL, got {base_url!r}. "
            "Pass the deployment origin, for example https://app-staging.spctre.dev"
        )
    if not parts.netloc:
        raise ValueError(f"base_url is missing a host: {base_url!r}")
    if parts.query or parts.fragment:
        raise ValueError(f"base_url must not carry a query string or fragment: {base_url!r}")

    path = parts.path.rstrip("/")
    if not path.endswith(API_PREFIX):
        path = f"{path}{API_PREFIX}"

    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))
