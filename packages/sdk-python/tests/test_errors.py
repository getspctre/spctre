import pytest

from spctre import (
    SpctreAuthError,
    SpctreError,
    SpctrePermissionError,
    SpctreRequestError,
    SpctreServerError,
    SpctreTransportError,
)
from spctre.errors import error_for_status, transport_error

ENVELOPE = b'{"message":"policy import scope required","meta":{"traceId":"trace-abc123"}}'


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
    translated = error_for_status(status, ENVELOPE)

    assert isinstance(translated, expected)
    assert isinstance(translated, SpctreError)
    assert translated.status == status


def test_lifts_trace_id_and_message_from_envelope():
    translated = error_for_status(403, ENVELOPE)

    assert translated.trace_id == "trace-abc123"
    assert translated.message == "policy import scope required"
    assert "trace-abc123" in str(translated)


def test_survives_a_non_json_error_body():
    # A proxy or load balancer can return HTML; translation must not raise.
    translated = error_for_status(502, b"<html>bad gateway</html>")

    assert isinstance(translated, SpctreServerError)
    assert translated.trace_id is None
    assert translated.message == "Spctre request failed with HTTP 502"


def test_handles_a_str_body():
    translated = error_for_status(401, ENVELOPE.decode("utf-8"))

    assert isinstance(translated, SpctreAuthError)
    assert translated.trace_id == "trace-abc123"


def test_missing_body_falls_back_to_status_message():
    translated = error_for_status(404, None)

    assert translated.message == "Spctre request failed with HTTP 404"
    assert translated.trace_id is None


def test_a_json_body_that_is_not_an_object_is_tolerated():
    translated = error_for_status(400, b'["not", "an", "object"]')

    assert isinstance(translated, SpctreRequestError)
    assert translated.trace_id is None


def test_transport_errors_carry_no_status():
    translated = transport_error(OSError("connection refused"))

    assert isinstance(translated, SpctreTransportError)
    assert translated.status is None
    assert "connection refused" in translated.message
