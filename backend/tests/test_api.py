from fastapi.testclient import TestClient

from app.main import create_app
from app.services.device import DeviceInfo, detect_device


def make_client() -> TestClient:
    return TestClient(create_app())


def test_health() -> None:
    response = make_client().get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "visual-studio-chord-api",
        "version": "0.1.0",
    }


def test_device_contract(monkeypatch) -> None:
    fake_device = DeviceInfo(
        selectedDevice="cpu",
        torchAvailable=False,
        cudaAvailable=False,
        mpsAvailable=False,
        deviceName="CPU",
        cudaDeviceCount=0,
    )
    monkeypatch.setattr("app.api.routes.system.detect_device", lambda: fake_device)

    response = make_client().get("/api/device")

    assert response.status_code == 200
    assert response.json() == {
        "selectedDevice": "cpu",
        "torchAvailable": False,
        "cudaAvailable": False,
        "mpsAvailable": False,
        "deviceName": "CPU",
        "cudaDeviceCount": 0,
        "totalMemoryMb": None,
    }


def test_models_have_tolerant_camel_case_contract(monkeypatch) -> None:
    fake_device = DeviceInfo(
        selectedDevice="cpu",
        torchAvailable=False,
        cudaAvailable=False,
        mpsAvailable=False,
        deviceName="CPU",
        cudaDeviceCount=0,
    )
    monkeypatch.setattr("app.api.routes.system.detect_device", lambda: fake_device)

    payload = make_client().get("/api/models").json()

    assert payload["activeModel"] == "local-deterministic-v1"
    assert [model["id"] for model in payload["models"]] == [
        "local-deterministic-v1",
        "browser-linear-v1",
    ]
    assert payload["models"][0]["runtime"] == "cpu"


def test_rank_is_linear_deterministic_and_uses_id_for_ties(monkeypatch) -> None:
    fake_device = DeviceInfo(
        selectedDevice="cpu",
        torchAvailable=False,
        cudaAvailable=False,
        mpsAvailable=False,
        deviceName="CPU",
        cudaDeviceCount=0,
    )
    monkeypatch.setattr("app.api.routes.ranking.detect_device", lambda: fake_device)
    body = {
        "candidates": [
            {"id": "candidate-b", "features": {"novelty": 1, "fit": 2}},
            {"id": "candidate-a", "features": {"novelty": 1, "fit": 2}},
            {"id": "candidate-c", "features": {"novelty": 0, "fit": 4}},
        ],
        "preferenceWeights": {"fit": 0.5, "novelty": -0.25},
    }

    first = make_client().post("/api/rank", json=body)
    second = make_client().post("/api/rank", json=body)

    assert first.status_code == 200
    assert first.json() == second.json()
    assert first.json() == {
        "ranked": [
            {"id": "candidate-c", "score": 2.0},
            {"id": "candidate-a", "score": 0.75},
            {"id": "candidate-b", "score": 0.75},
        ],
        "device": "cpu",
    }


def test_rank_defaults_to_neutral_scores() -> None:
    response = make_client().post(
        "/api/rank",
        json={"candidates": [{"id": "z"}, {"id": "a"}]},
    )

    assert response.status_code == 200
    assert response.json()["ranked"] == [
        {"id": "a", "score": 0.0},
        {"id": "z", "score": 0.0},
    ]


def test_rank_rejects_duplicate_ids_and_unknown_fields() -> None:
    duplicate = make_client().post(
        "/api/rank",
        json={"candidates": [{"id": "same"}, {"id": "same"}]},
    )
    unknown = make_client().post(
        "/api/rank",
        json={"candidates": [{"id": "one", "path": "/tmp/model.pkl"}]},
    )

    assert duplicate.status_code == 422
    assert unknown.status_code == 422


def test_rank_rejects_non_numeric_feature_values() -> None:
    response = make_client().post(
        "/api/rank",
        json={"candidates": [{"id": "one", "features": {"fit": "high"}}]},
    )

    assert response.status_code == 422


def test_cors_allows_default_localhost_and_not_external_origins() -> None:
    client = make_client()
    headers = {
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    }

    allowed = client.options("/api/rank", headers=headers)
    denied = client.options(
        "/api/rank",
        headers={**headers, "Origin": "https://example.com"},
    )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert denied.status_code == 400
    assert "access-control-allow-origin" not in denied.headers


def teardown_module() -> None:
    detect_device.cache_clear()
