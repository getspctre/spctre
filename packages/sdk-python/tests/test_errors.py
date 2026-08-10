import pytest
from spctre.exceptions import ApiException

from spctre_sdk import (
    SpctreAuthError,
    SpctreError,
    SpctrePermissionError,
    SpctreRequestError,
    SpctreServerError,
    SpctreTransportError,
)
from spctre_sdk.errors import translate_api_exception

ENVELOPE = '{"message":"policy import scope required","meta":{"traceId":"trace-abc123"}}'


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (401, SpctreAuthError),
        (403, SpctrePermissionError),
        (400, SpctreRequestError),
        (404, SpctreRequestError),
        (409, SpctreRequestError),
        (422, SpctreRequestError),
        (500, SpctreServerError),
        (503, SpctreServerError),
    ],
)
def test_maps_status_to_error_type(status, expected):
    translated = translate_api_exception(ApiException(status=status, body=ENVELOPE))
    assert isinstance(translated, expected)
    assert isinstance(translated, SpctreError)
    assert translated.status == status


def test_lifts_trace_id_and_message_from_envelope():
    translated = translate_api_exception(ApiException(status=403, body=ENVELOPE))
    assert translated.trace_id == "trace-abc123"
    assert translated.message == "policy import scope required"
    assert "trace-abc123" in str(translated)


def test_survives_a_non_json_error_body():
    # A proxy or load balancer can return HTML; translation must not raise.
    translated = translate_api_exception(ApiException(status=502, body="<html>bad gateway</html>"))
    assert isinstance(translated, SpctreServerError)
    assert translated.trace_id is None
    assert translated.message == "Spctre request failed with HTTP 502"


def test_handles_a_bytes_body():
    # The generated client decodes the body to str, but the attribute is
    # untyped at the point translation reads it. Set it directly rather than
    # through the constructor, which declares str.
    exc = ApiException(status=401)
    exc.body = ENVELOPE.encode("utf-8")  # type: ignore[assignment]

    translated = translate_api_exception(exc)

    assert isinstance(translated, SpctreAuthError)
    assert translated.trace_id == "trace-abc123"


def test_non_http_failures_become_transport_errors():
    translated = translate_api_exception(OSError("connection refused"))
    assert isinstance(translated, SpctreTransportError)
    assert translated.status is None


def test_missing_body_falls_back_to_status_message():
    translated = translate_api_exception(ApiException(status=404))
    assert translated.message == "Spctre request failed with HTTP 404"
    assert translated.trace_id is None
