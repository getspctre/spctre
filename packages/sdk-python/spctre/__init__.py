"""Supported Python client for the Spctre control plane.

    from spctre import SpctreClient

    client = SpctreClient(base_url="https://app-staging.spctre.dev", token=token)
    decision = client.gateway.decide(request)

Request and response models live in `spctre.models`. The full generated
surface, including operations the facade does not wrap, is under
`spctre._generated` — regenerated wholesale from the OpenAPI spec and not
covered by this package's stability promise.
"""

from . import models
from ._url import API_PREFIX, normalize_base_url
from ._version import __version__
from .client import UNSET, SpctreClient, Unset
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
    "UNSET",
    "Unset",
    "__version__",
    "models",
    "normalize_base_url",
]
