"""Supported Python client for the Spctre control plane.

    from spctre_sdk import SpctreClient

    client = SpctreClient(base_url="https://app-staging.spctre.dev", token=token)
    decision = client.gateway.decide(request)

The generated bindings for the full API surface remain available under the
`spctre` package; this module is the narrow, supported subset.
"""

from ._url import API_PREFIX, normalize_base_url
from ._version import __version__
from .client import SpctreClient, Transport
from .errors import (
    SpctreAuthError,
    SpctreError,
    SpctrePermissionError,
    SpctreRequestError,
    SpctreResponseError,
    SpctreServerError,
    SpctreTransportError,
)

__all__ = [
    "API_PREFIX",
    "SpctreAuthError",
    "SpctreClient",
    "SpctreError",
    "SpctrePermissionError",
    "SpctreRequestError",
    "SpctreResponseError",
    "SpctreServerError",
    "SpctreTransportError",
    "Transport",
    "__version__",
    "normalize_base_url",
]
