import pytest

from app.core.config import Settings, validate_cors_origin


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:4173",
        "https://127.0.0.1:8443",
        "http://127.1.2.3:3000",
        "http://[::1]:5173",
    ],
)
def test_loopback_cors_origins_are_allowed(origin: str) -> None:
    assert validate_cors_origin(origin) == origin


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "https://example.com",
        "http://192.168.1.50:5173",
        "file:///tmp/index.html",
        "http://localhost:5173/path",
        "http://user@localhost:5173",
    ],
)
def test_non_loopback_or_non_origin_cors_values_are_rejected(origin: str) -> None:
    with pytest.raises(ValueError):
        validate_cors_origin(origin)


def test_origins_are_configurable_from_environment(monkeypatch) -> None:
    monkeypatch.setenv(
        "MTC_CORS_ORIGINS",
        "http://localhost:3000, http://127.0.0.1:3000/",
    )

    assert Settings.from_env().cors_origins == (
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    )

