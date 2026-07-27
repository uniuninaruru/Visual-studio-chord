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


@pytest.mark.parametrize(
    "preference",
    ["auto", "corpus", "linear", "mlp", "onnx", "mock-deterministic"],
)
def test_inference_preference_is_configurable(monkeypatch, preference: str) -> None:
    monkeypatch.setenv("MTC_INFERENCE_MODEL", preference.upper())

    assert Settings.from_env().inference_model == preference


def test_invalid_inference_preference_fails_closed(monkeypatch) -> None:
    monkeypatch.setenv("MTC_INFERENCE_MODEL", "../../model.pkl")

    with pytest.raises(ValueError, match="MTC_INFERENCE_MODEL"):
        Settings.from_env()


def test_model_directory_is_configurable(monkeypatch, tmp_path) -> None:
    model_directory = tmp_path / "large-local-models"
    monkeypatch.setenv("MODEL_DIRECTORY", str(model_directory))

    assert Settings.from_env().model_directory == model_directory.resolve()


def test_shared_token_is_loaded_without_being_exposed_in_repr(monkeypatch) -> None:
    token = "test-token-1234567890"
    monkeypatch.setenv("MTC_SHARED_TOKEN", token)

    settings = Settings.from_env()

    assert settings.shared_token == token
    assert token not in repr(settings)


@pytest.mark.parametrize(
    "token",
    ["too-short", 'valid-length";inject', "valid-length-token\nnext"],
)
def test_unsafe_shared_token_is_rejected(token: str) -> None:
    with pytest.raises(ValueError, match="MTC_SHARED_TOKEN"):
        Settings(shared_token=token)
