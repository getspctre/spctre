import pytest

from spctre import normalize_base_url


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        # The documented staging and production shapes.
        ("https://app-staging.spctre.dev", "https://app-staging.spctre.dev/api/v1"),
        ("https://app-staging.spctre.dev/", "https://app-staging.spctre.dev/api/v1"),
        ("https://app.example.com//", "https://app.example.com/api/v1"),
        # Local development.
        ("http://localhost:3000", "http://localhost:3000/api/v1"),
        # A deployment mounted under a sub-path behind a reverse proxy.
        ("https://internal.example.com/spctre", "https://internal.example.com/spctre/api/v1"),
        # Already-versioned input is accepted rather than doubled, so
        # round-tripping client.base_url back into the constructor is safe.
        ("https://app-staging.spctre.dev/api/v1", "https://app-staging.spctre.dev/api/v1"),
        ("https://app-staging.spctre.dev/api/v1/", "https://app-staging.spctre.dev/api/v1"),
        # Surrounding whitespace is a copy-paste artifact, not an error.
        ("  https://app.example.com  ", "https://app.example.com/api/v1"),
    ],
)
def test_normalizes_deployment_urls(given, expected):
    assert normalize_base_url(given) == expected


@pytest.mark.parametrize(
    "given",
    [
        "",
        "   ",
        "app-staging.spctre.dev",  # no scheme
        "ftp://app.example.com",  # wrong scheme
        "https://",  # no host
        "https://app.example.com?token=leaked",  # query string
        "https://app.example.com#frag",
    ],
)
def test_rejects_unusable_base_urls(given):
    with pytest.raises(ValueError):
        normalize_base_url(given)


def test_rejects_non_string():
    with pytest.raises(ValueError):
        normalize_base_url(None)  # type: ignore[arg-type]
