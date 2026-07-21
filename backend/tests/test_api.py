from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services.device import DeviceInfo, detect_device
from app.services.models import ModelManager
from app.services.runtime import ModelUnavailableError


def make_client() -> TestClient:
    return TestClient(create_app(Settings(inference_model="linear")))


def assert_error_contract(response, status_code: int, code: str) -> None:
    assert response.status_code == status_code
    payload = response.json()
    assert payload["apiVersion"] == "1"
    assert payload["requestId"] == response.headers["X-Request-ID"]
    assert payload["success"] is False
    assert payload["error"]["code"] == code
    assert isinstance(payload["error"]["message"], str)
    assert payload["error"]["message"]


def test_health() -> None:
    response = make_client().get("/api/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["apiVersion"] == "1"
    assert len(payload["requestId"]) == 32
    assert payload["status"] == "ok"
    assert payload["service"] == "music-theory-composer-api"
    assert payload["version"] == "0.2.0"
    assert payload["pythonVersion"]
    assert payload["platformSystem"]
    assert payload["platformMachine"]
    assert payload["authRequired"] is False
    assert payload["inferenceAuthorized"] is True
    assert payload["activeModel"] == "local-deterministic-v1"
    assert payload["backend"] == "linear"
    assert payload["mock"] is False


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
        "apiVersion": "1",
        "requestId": response.headers["X-Request-ID"],
        "selectedDevice": "cpu",
        "torchAvailable": False,
        "onnxRuntimeAvailable": False,
        "cudaAvailable": False,
        "torchCudaAvailable": False,
        "onnxCudaAvailable": False,
        "mpsAvailable": False,
        "coremlAvailable": False,
        "directmlAvailable": False,
        "deviceName": "CPU",
        "cudaDeviceCount": 0,
        "totalMemoryMb": None,
    }


def test_openapi_contract_is_deterministic_and_has_stable_operation_ids() -> None:
    first = create_app(Settings(inference_model="linear")).openapi()
    second = create_app(Settings(inference_model="linear")).openapi()

    assert first == second
    assert first["info"]["version"] == "0.2.0"
    assert first["paths"]["/api/health"]["get"]["operationId"] == "getHealth"
    assert first["paths"]["/api/device"]["get"]["operationId"] == "getDevice"
    assert first["paths"]["/api/models"]["get"]["operationId"] == "listModels"
    assert first["paths"]["/api/rank"]["post"]["operationId"] == "rankCandidates"
    assert (
        first["paths"]["/api/preferences/update"]["post"]["operationId"]
        == "updatePreferences"
    )
    assert first["paths"]["/api/models/load"]["post"]["operationId"] == "loadModel"
    assert (
        first["paths"]["/api/models/unload"]["post"]["operationId"]
        == "unloadModel"
    )
    health_schema = first["components"]["schemas"]["HealthResponse"]
    device_schema = first["components"]["schemas"]["DeviceResponse"]
    models_schema = first["components"]["schemas"]["ModelsResponse"]
    rank_request_schema = first["components"]["schemas"]["RankRequest"]
    rank_schema = first["components"]["schemas"]["RankResponse"]
    assert "apiVersion" in health_schema["required"]
    assert "authRequired" in health_schema["required"]
    assert "inferenceAuthorized" in health_schema["required"]
    assert "pythonVersion" in health_schema["required"]
    assert "platformSystem" in health_schema["required"]
    assert "platformMachine" in health_schema["required"]
    assert "apiVersion" in device_schema["required"]
    assert "requestId" in device_schema["required"]
    assert {"activeModel", "activeRuntime"} <= set(models_schema["required"])
    assert (
        rank_request_schema["properties"]["preferenceCategory"]["default"]
        == "combined"
    )
    assert {"modelId", "runtime", "batchSize"} <= set(rank_schema["required"])
    error_schema = first["components"]["schemas"]["ErrorResponse"]
    assert {"apiVersion", "requestId", "success", "error"} <= set(
        error_schema["required"]
    )
    rank_operation = first["paths"]["/api/rank"]["post"]
    assert rank_operation["security"] == [{"MtcSharedToken": []}]
    assert {"401", "403", "422", "500", "503"} <= set(
        rank_operation["responses"]
    )
    assert first["components"]["securitySchemes"]["MtcSharedToken"] == {
        "type": "apiKey",
        "description": (
            "Shared LAN token. Required only when GET /api/health reports "
            "authRequired=true."
        ),
        "in": "header",
        "name": "X-MTC-Token",
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
    assert payload["activeRuntime"] == "cpu"
    assert payload["fallbackReason"] is None
    assert [model["id"] for model in payload["models"]] == [
        "local-deterministic-v1",
        "local-mlp-v1",
        "local-onnx-v1",
        "mock-deterministic-v1",
        "browser-linear-v1",
    ]
    assert payload["models"][0]["runtime"] == "cpu"


def test_rank_is_linear_deterministic_and_uses_id_for_ties() -> None:
    body = {
        "candidates": [
            {"id": "candidate-b", "features": {"novelty": 1, "fit": 2}},
            {"id": "candidate-a", "features": {"novelty": 1, "fit": 2}},
            {"id": "candidate-c", "features": {"novelty": 0, "fit": 4}},
        ],
        "preferenceWeights": {"fit": 0.5, "novelty": -0.25},
        "requestId": "rank-test",
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
        "modelId": "local-deterministic-v1",
        "runtime": "cpu",
        "batchSize": 3,
        "apiVersion": "1",
        "requestId": "rank-test",
        "backend": "linear",
        "mock": False,
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


def test_rank_rejects_oversized_batches() -> None:
    response = make_client().post(
        "/api/rank",
        json={"candidates": [{"id": "one"}], "batchSize": 129},
    )

    assert response.status_code == 422


def test_model_actions_are_allowlisted_and_do_not_accept_paths() -> None:
    client = make_client()

    loaded = client.post(
        "/api/models/load",
        json={"modelId": "local-deterministic-v1"},
    )
    unknown = client.post("/api/models/load", json={"modelId": "../../model.pkl"})
    path_field = client.post(
        "/api/models/load",
        json={"modelId": "local-deterministic-v1", "path": "/tmp/model.pkl"},
    )
    protected = client.post(
        "/api/models/unload",
        json={"modelId": "local-deterministic-v1"},
    )

    assert loaded.status_code == 200
    assert loaded.json()["activeModel"] == "local-deterministic-v1"
    assert loaded.json()["activeRuntime"] == "cpu"
    assert unknown.status_code == 422
    assert path_field.status_code == 422
    assert protected.status_code == 409


def test_startup_runtime_fallback_is_visible_in_api(monkeypatch) -> None:
    def unavailable(self, model_id):
        raise ModelUnavailableError("missing optional dependency")

    monkeypatch.setattr(ModelManager, "_load_optional_runtime", unavailable)
    client = TestClient(create_app(Settings(inference_model="onnx")))

    models = client.get("/api/models").json()
    rank = client.post("/api/rank", json={"candidates": [{"id": "one"}]}).json()

    assert models["activeModel"] == "local-deterministic-v1"
    assert models["activeRuntime"] == "cpu"
    assert models["fallbackReason"] == "onnxUnavailableCpuFallback"
    assert rank["runtime"] == "cpu"
    assert rank["fallbackReason"] == "onnxUnavailableCpuFallback"


def test_failed_model_action_preserves_body_request_id(monkeypatch) -> None:
    client = make_client()

    def unavailable(model_id):
        raise ModelUnavailableError("optional runtime unavailable")

    monkeypatch.setattr(client.app.state.model_manager, "load", unavailable)
    response = client.post(
        "/api/models/load",
        json={"modelId": "local-mlp-v1", "requestId": "failed-load-1"},
    )

    assert response.status_code == 503
    assert response.headers["X-Request-ID"] == "failed-load-1"


def test_preference_updates_are_bounded_and_category_scoped() -> None:
    client = make_client()
    body = {
        "category": "chords",
        "feedback": "like",
        "features": {"cadence": 2.0, "novelty": -1.0},
    }

    first = client.post("/api/preferences/update", json=body)
    second = client.post("/api/preferences/update", json=body)
    melody = client.post(
        "/api/preferences/update",
        json={**body, "category": "melody"},
    )

    assert first.status_code == 200
    assert first.json() == {
        "apiVersion": "1",
        "requestId": first.json()["requestId"],
        "weights": {"cadence": 0.1, "novelty": -0.05},
        "evaluationCount": 1,
        "confidence": 0.08,
    }
    assert second.json()["weights"] == {"cadence": 0.2, "novelty": -0.1}
    assert second.json()["evaluationCount"] == 2
    assert melody.json()["evaluationCount"] == 1


def test_rank_uses_one_authoritative_preference_profile() -> None:
    client = make_client()
    update = client.post(
        "/api/preferences/update",
        json={
            "category": "chords",
            "feedback": "like",
            "features": {"fit": 1.0},
        },
    )

    learned = client.post(
        "/api/rank",
        json={
            "preferenceCategory": "chords",
            "candidates": [
                {"id": "candidate-a", "features": {"fit": 0.0}},
                {"id": "candidate-b", "features": {"fit": 1.0}},
            ],
        },
    )
    other_category = client.post(
        "/api/rank",
        json={
            "preferenceCategory": "melody",
            "candidates": [
                {"id": "candidate-a", "features": {"fit": 0.0}},
                {"id": "candidate-b", "features": {"fit": 1.0}},
            ],
        },
    )
    explicit_profile = client.post(
        "/api/rank",
        json={
            "preferenceCategory": "chords",
            # The browser learner records this same Like as +0.18.
            "preferenceWeights": {"fit": 0.18},
            "candidates": [
                {"id": "candidate-a", "features": {"fit": 0.0}},
                {"id": "candidate-b", "features": {"fit": 1.0}},
            ],
        },
    )
    explicitly_empty_profile = client.post(
        "/api/rank",
        json={
            "preferenceCategory": "chords",
            "preferenceWeights": {},
            "candidates": [
                {"id": "candidate-a", "features": {"fit": 0.0}},
                {"id": "candidate-b", "features": {"fit": 1.0}},
            ],
        },
    )

    assert update.status_code == 200
    assert learned.status_code == 200
    assert learned.json()["ranked"] == [
        {"id": "candidate-b", "score": 0.05},
        {"id": "candidate-a", "score": 0.0},
    ]
    assert other_category.status_code == 200
    assert other_category.json()["ranked"] == [
        {"id": "candidate-a", "score": 0.0},
        {"id": "candidate-b", "score": 0.0},
    ]
    assert explicit_profile.status_code == 200
    # The browser profile already contains the feedback synchronized above.
    # Treating it as authoritative avoids adding the same signal twice.
    assert explicit_profile.json()["ranked"] == [
        {"id": "candidate-b", "score": 0.18},
        {"id": "candidate-a", "score": 0.0},
    ]
    # An explicit empty browser profile (for example, after Reset) must not
    # resurrect process-local server feedback from the previous profile.
    assert explicitly_empty_profile.status_code == 200
    assert explicitly_empty_profile.json()["ranked"] == [
        {"id": "candidate-a", "score": 0.0},
        {"id": "candidate-b", "score": 0.0},
    ]


def test_preference_update_rejects_empty_features_and_excessive_weight() -> None:
    client = make_client()
    base = {"category": "combined", "feedback": "favorite"}

    empty = client.post("/api/preferences/update", json={**base, "features": {}})
    excessive = client.post(
        "/api/preferences/update",
        json={**base, "features": {"fit": 1.0}, "weight": 5.0},
    )

    assert empty.status_code == 422
    assert excessive.status_code == 422


def test_preference_weights_are_clamped() -> None:
    response = make_client().post(
        "/api/preferences/update",
        json={
            "category": "combined",
            "feedback": "favorite",
            "features": {"fit": 1_000_000.0},
            "weight": 4.0,
        },
    )

    assert response.status_code == 200
    assert response.json()["weights"] == {"fit": 5.0}


def test_request_id_header_and_body_contract() -> None:
    client = make_client()
    health = client.get("/api/health", headers={"X-Request-ID": "header-request-1"})
    rank = client.post(
        "/api/rank",
        headers={"X-Request-ID": "header-request-2"},
        json={
            "apiVersion": "1",
            "requestId": "body-request-2",
            "candidates": [{"id": "one"}],
        },
    )

    assert health.json()["requestId"] == "header-request-1"
    assert health.headers["X-Request-ID"] == "header-request-1"
    assert rank.json()["requestId"] == "body-request-2"
    assert rank.headers["X-Request-ID"] == "body-request-2"
    assert rank.json()["apiVersion"] == "1"


def test_invalid_api_version_and_request_id_are_rejected() -> None:
    client = make_client()

    version = client.post(
        "/api/rank",
        json={"apiVersion": "2", "candidates": [{"id": "one"}]},
    )
    request_id = client.post(
        "/api/rank",
        json={"requestId": "../unsafe", "candidates": [{"id": "one"}]},
    )

    assert version.status_code == 422
    assert request_id.status_code == 422


def test_mock_development_backend_is_reproducible_and_visible() -> None:
    client = TestClient(create_app(Settings(inference_model="mock-deterministic")))
    body = {
        "requestId": "mock-rank",
        "candidates": [
            {"id": "b", "features": {"fit": 1.0}},
            {"id": "a", "features": {"fit": -1.0}},
        ],
    }

    health = client.get("/api/health").json()
    models = client.get("/api/models").json()
    first = client.post("/api/rank", json=body).json()
    second = client.post("/api/rank", json=body).json()

    assert health["backend"] == "mock"
    assert health["mock"] is True
    assert models["activeModel"] == "mock-deterministic-v1"
    assert models["activeBackend"] == "mock"
    assert models["mock"] is True
    assert first == second
    assert first["backend"] == "mock"
    assert first["mock"] is True


def test_preference_store_rejects_unbounded_distinct_features() -> None:
    client = make_client()

    for offset in (0, 128):
        response = client.post(
            "/api/preferences/update",
            json={
                "category": "rhythm",
                "feedback": "like",
                "features": {f"feature{index}": 1.0 for index in range(offset, offset + 128)},
            },
        )
        assert response.status_code == 200

    rejected = client.post(
        "/api/preferences/update",
        json={
            "category": "rhythm",
            "feedback": "like",
            "features": {"feature256": 1.0},
        },
    )

    assert rejected.status_code == 409


def test_shared_token_protects_inference_and_mutation_routes() -> None:
    token = "local-shared-token-12345"
    client = TestClient(
        create_app(Settings(inference_model="linear", shared_token=token))
    )

    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["authRequired"] is True
    assert health.json()["inferenceAuthorized"] is False
    assert client.get(
        "/api/health",
        headers={"X-MTC-Token": "wrong-token-12345"},
    ).json()["inferenceAuthorized"] is False
    assert client.get(
        "/api/health",
        headers={"X-MTC-Token": token},
    ).json()["inferenceAuthorized"] is True
    assert client.get("/api/device").status_code == 200
    assert client.get("/api/models").status_code == 200

    protected_requests = [
        ("/api/rank", {"candidates": [{"id": "one"}]}),
        (
            "/api/preferences/update",
            {"category": "chords", "feedback": "like", "features": {"fit": 1.0}},
        ),
        ("/api/models/load", {"modelId": "local-deterministic-v1"}),
        ("/api/models/unload", {"modelId": "local-mlp-v1"}),
    ]
    for path, body in protected_requests:
        missing = client.post(path, json=body, headers={"X-Request-ID": "auth-test"})
        wrong = client.post(path, json=body, headers={"X-MTC-Token": "wrong-token"})
        valid = client.post(path, json=body, headers={"X-MTC-Token": token})

        assert_error_contract(missing, 401, "AUTHENTICATION_REQUIRED")
        assert missing.headers["X-Request-ID"] == "auth-test"
        assert_error_contract(wrong, 403, "INVALID_AUTHENTICATION_TOKEN")
        assert valid.status_code == 200
        assert token not in valid.text


def test_onnx_provider_discovery_failure_is_sanitized_as_503(monkeypatch) -> None:
    broken_ort = SimpleNamespace(
        get_available_providers=lambda: (_ for _ in ()).throw(
            RuntimeError("native provider discovery details")
        )
    )
    monkeypatch.setattr("app.services.models.import_onnxruntime", lambda: broken_ort)
    client = make_client()

    loaded = client.post("/api/models/load", json={"modelId": "local-onnx-v1"})
    ranked = client.post(
        "/api/rank",
        json={
            "modelId": "local-onnx-v1",
            "candidates": [{"id": "one"}],
        },
    )

    assert_error_contract(loaded, 503, "SERVICE_UNAVAILABLE")
    assert_error_contract(ranked, 503, "SERVICE_UNAVAILABLE")
    assert "native provider" not in loaded.text
    assert "native provider" not in ranked.text


def test_onnx_session_provider_failure_is_sanitized_as_503(monkeypatch) -> None:
    class BrokenSession:
        def __init__(self, _model, providers) -> None:
            self.providers = providers

        def get_providers(self):
            raise RuntimeError("native session provider details")

    broken_ort = SimpleNamespace(
        get_available_providers=lambda: ["CPUExecutionProvider"],
        InferenceSession=BrokenSession,
    )
    monkeypatch.setattr("app.services.models.import_onnxruntime", lambda: broken_ort)

    response = make_client().post(
        "/api/models/load",
        json={"modelId": "local-onnx-v1"},
    )

    assert_error_contract(response, 503, "SERVICE_UNAVAILABLE")
    assert "native session" not in response.text


def test_validation_errors_use_versioned_safe_contract() -> None:
    response = make_client().post(
        "/api/rank",
        json={"candidates": []},
        headers={"X-Request-ID": "validation-test"},
    )

    assert_error_contract(response, 422, "VALIDATION_ERROR")
    assert response.headers["X-Request-ID"] == "validation-test"
    assert response.json()["error"]["message"] == "Request validation failed."


def test_http_error_contract_preserves_protocol_headers() -> None:
    response = make_client().post("/api/health")

    assert_error_contract(response, 405, "METHOD_NOT_ALLOWED")
    assert response.headers["allow"] == "GET"


def test_unexpected_errors_keep_contract_headers_and_cors(monkeypatch) -> None:
    client = make_client()

    def fail_rank(*_args, **_kwargs):
        raise RuntimeError("native stack and filesystem details")

    monkeypatch.setattr(client.app.state.model_manager, "rank", fail_rank)
    response = client.post(
        "/api/rank",
        json={"candidates": [{"id": "one"}]},
        headers={
            "Origin": "http://localhost:5173",
            "X-Request-ID": "unexpected-test",
        },
    )

    assert_error_contract(response, 500, "INTERNAL_ERROR")
    assert response.headers["X-Request-ID"] == "unexpected-test"
    assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert "native stack" not in response.text
    assert "filesystem" not in response.text


def test_cors_allows_default_localhost_and_not_external_origins() -> None:
    client = make_client()
    headers = {
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": (
            "content-type,x-request-id,x-api-version,x-mtc-token"
        ),
    }

    allowed = client.options("/api/rank", headers=headers)
    denied = client.options(
        "/api/rank",
        headers={**headers, "Origin": "https://example.com"},
    )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "x-request-id" in allowed.headers["access-control-allow-headers"].lower()
    assert "x-mtc-token" in allowed.headers["access-control-allow-headers"].lower()
    assert denied.status_code == 400
    assert "access-control-allow-origin" not in denied.headers

    visible = client.get(
        "/api/health",
        headers={"Origin": "http://localhost:5173"},
    )
    exposed = visible.headers["access-control-expose-headers"].lower()
    assert "x-request-id" in exposed
    assert "x-api-version" in exposed


def teardown_module() -> None:
    detect_device.cache_clear()
