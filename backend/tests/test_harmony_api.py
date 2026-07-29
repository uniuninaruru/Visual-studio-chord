import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def _body(
    *,
    request_id: str = "harmony-api-test",
    model_id: str = "mock-harmonyforge-bimask-v1",
) -> dict:
    return {
        "apiVersion": "2",
        "requestId": request_id,
        "modelId": model_id,
        "seed": "1729",
        "candidateCount": 3,
        "allowCpuFallback": True,
        "melody": [
            {
                "startTick": 0,
                "durationTick": 960,
                "midi": 64,
                "velocity": 96,
                "role": "chordTone",
            }
        ],
        "existingHarmony": [],
        "generationMask": [
            {"startTick": 0, "endTick": 7680, "mode": "generate"},
        ],
        "tonalities": [
            {"startTick": 0, "endTick": 7680, "keyRoot": 0, "mode": "major"},
        ],
        "controls": {
            "ppq": 480,
            "ticksPerBar": 1920,
            "timeSignature": "4/4",
            "startTick": 0,
            "endTick": 7680,
        },
    }


def _client(
    tmp_path: Path,
    *,
    enable_mock: bool = True,
    shared_token: str | None = None,
) -> TestClient:
    return TestClient(
        create_app(
            Settings(
                inference_model="linear",
                model_directory=tmp_path / "models",
                enable_neural_mock=enable_mock,
                shared_token=shared_token,
            )
        )
    )


def _wait_for_terminal(client: TestClient, request_id: str) -> dict:
    for _ in range(100):
        response = client.get(f"/api/v2/jobs/{request_id}")
        assert response.headers["X-API-Version"] == "2"
        payload = response.json()
        if payload["state"] in {"completed", "cancelled", "failed"}:
            return payload
        time.sleep(0.005)
    raise AssertionError("harmony job did not become terminal")


def test_mock_harmony_job_is_async_versioned_and_preview_only(tmp_path) -> None:
    with _client(tmp_path) as client:
        started = client.post("/api/v2/harmony/generate", json=_body())

        assert started.status_code == 202
        assert started.headers["X-API-Version"] == "2"
        assert started.json()["apiVersion"] == "2"
        completed = _wait_for_terminal(client, "harmony-api-test")

    assert completed["state"] == "completed"
    assert completed["stage"] == "Complete"
    assert completed["mock"] is True
    assert completed["trained"] is False
    assert completed["partialCandidateStored"] is False
    assert len(completed["candidates"]) == 3
    assert all(candidate["adoptable"] is False for candidate in completed["candidates"])
    assert all(
        candidate["hardRuleValidation"] == "pendingClient"
        for candidate in completed["candidates"]
    )


def test_mock_generated_spans_reuse_source_factors_but_remain_preview_only(
    tmp_path,
) -> None:
    body = _body(request_id="mock-source-conditioned")
    body["existingHarmony"] = [
        {
            "startTick": 0,
            "durationTick": 960,
            "rootOffsetFromKey": 0,
            "quality": "major",
            "inversion": 0,
            "bassOffsetFromRoot": 0,
            "extensions": [],
            "locked": False,
        },
        {
            "startTick": 960,
            "durationTick": 6720,
            "rootOffsetFromKey": 5,
            "quality": "major",
            "inversion": 1,
            "bassOffsetFromRoot": 4,
            "extensions": ["9"],
            "locked": False,
        },
    ]

    with _client(tmp_path) as client:
        started = client.post("/api/v2/harmony/generate", json=body)
        assert started.status_code == 202
        completed = _wait_for_terminal(client, "mock-source-conditioned")

    expected = [
        {
            "startTick": 0,
            "durationTick": 960,
            "rootOffsetFromKey": 0,
            "quality": "major",
            "inversion": 0,
            "bassOffsetFromRoot": 0,
            "extensions": [],
            "confidence": 1.0,
            "maskMode": "generated",
        },
        {
            "startTick": 960,
            "durationTick": 6720,
            "rootOffsetFromKey": 5,
            "quality": "major",
            "inversion": 1,
            "bassOffsetFromRoot": 4,
            "extensions": ["9"],
            "confidence": 1.0,
            "maskMode": "generated",
        },
    ]
    assert completed["state"] == "completed"
    assert len(completed["candidates"]) == 3
    assert all(candidate["events"] == expected for candidate in completed["candidates"])
    assert all(candidate["adoptable"] is False for candidate in completed["candidates"])
    assert all(
        candidate["requiresClientValidation"] is True
        for candidate in completed["candidates"]
    )


def test_missing_real_checkpoint_fails_without_fake_candidate(tmp_path) -> None:
    with _client(tmp_path) as client:
        started = client.post(
            "/api/v2/harmony/generate",
            json=_body(
                request_id="missing-checkpoint",
                model_id="harmonyforge-bimask-base-v1",
            ),
        )
        assert started.status_code == 202
        failed = _wait_for_terminal(client, "missing-checkpoint")

        manifest = client.get(
            "/api/v2/models/harmonyforge-bimask-base-v1/manifest"
        )

    assert failed["state"] == "failed"
    assert failed["candidates"] == []
    assert failed["error"]["code"] == "MODEL_UNAVAILABLE"
    assert failed["error"]["compositionSafe"] is True
    assert manifest.status_code == 200
    assert manifest.json()["available"] is False
    assert manifest.json()["trained"] is False


def test_missing_neural_config_keeps_model_discovery_healthy(tmp_path) -> None:
    client = TestClient(
        create_app(
            Settings(
                inference_model="linear",
                model_directory=tmp_path / "models",
                neural_config_path=tmp_path / "missing-config.yaml",
            )
        )
    )

    response = client.get("/api/models")

    assert response.status_code == 200
    neural = next(
        model
        for model in response.json()["models"]
        if model["id"] == "harmonyforge-bimask-base-v1"
    )
    assert neural["available"] is False
    assert neural["loaded"] is False
    assert neural["runtime"] is None


def test_model_discovery_reports_loaded_harmony_backend_actual_device(
    tmp_path,
    monkeypatch,
) -> None:
    with _client(tmp_path) as client:
        manager = client.app.state.harmony_model_manager
        backend = manager._real
        backend._model = object()
        backend._loaded_checkpoint = object()
        backend._device = "cpu"
        backend._dtype = "float32"
        backend._fallback_reason = "cudaInferenceFailedCpuFallback"
        monkeypatch.setattr(
            backend,
            "manifest",
            lambda: {
                "modelId": "harmonyforge-bimask-base-v1",
                "available": True,
                "mock": False,
            },
        )

        response = client.get("/api/models")

    assert response.status_code == 200
    neural = next(
        model
        for model in response.json()["models"]
        if model["id"] == "harmonyforge-bimask-base-v1"
    )
    assert neural["loaded"] is True
    assert neural["runtime"] == "cpu"


def test_v2_generate_and_cancel_require_lan_token(tmp_path) -> None:
    token = "0123456789abcdef0123456789abcdef"
    with _client(tmp_path, shared_token=token) as client:
        rejected = client.post("/api/v2/harmony/generate", json=_body())
        accepted = client.post(
            "/api/v2/harmony/generate",
            json=_body(request_id="authorized-job"),
            headers={"X-MTC-Token": token},
        )

    assert rejected.status_code == 401
    assert rejected.headers["X-API-Version"] == "2"
    assert rejected.json()["apiVersion"] == "2"
    assert accepted.status_code == 202


def test_job_request_id_is_idempotent_but_not_reusable_for_other_input(tmp_path) -> None:
    with _client(tmp_path) as client:
        first = client.post("/api/v2/harmony/generate", json=_body())
        same = client.post("/api/v2/harmony/generate", json=_body())
        changed_body = _body()
        changed_body["seed"] = "different"
        conflict = client.post("/api/v2/harmony/generate", json=changed_body)

    assert first.status_code == 202
    assert same.status_code == 202
    assert conflict.status_code == 409
    assert conflict.json()["apiVersion"] == "2"


def test_unknown_job_and_mismatched_cancel_are_safe(tmp_path) -> None:
    with _client(tmp_path) as client:
        missing = client.get("/api/v2/jobs/does-not-exist")
        mismatch = client.post(
            "/api/v2/harmony/cancel/path-id",
            json={"apiVersion": "2", "requestId": "body-id"},
        )

    assert missing.status_code == 404
    assert mismatch.status_code == 409
    assert missing.json()["apiVersion"] == "2"
    assert mismatch.json()["apiVersion"] == "2"


def test_repeated_job_poll_uses_submission_manifest_snapshot(
    tmp_path,
    monkeypatch,
) -> None:
    with _client(tmp_path) as client:
        manager = client.app.state.harmony_model_manager
        original = manager.manifest
        calls = 0

        def counted(model_id):
            nonlocal calls
            calls += 1
            return original(model_id)

        monkeypatch.setattr(manager, "manifest", counted)
        started = client.post("/api/v2/harmony/generate", json=_body())
        assert started.status_code == 202
        for _ in range(20):
            assert client.get("/api/v2/jobs/harmony-api-test").status_code == 200
        duplicate = client.post("/api/v2/harmony/generate", json=_body())

    assert duplicate.status_code == 202
    assert calls == 1


def test_repeated_public_discovery_does_not_rehash_unchanged_artifacts(
    tmp_path,
    monkeypatch,
) -> None:
    import app.ml.backends.torch_backend as torch_backend

    original = torch_backend.load_validated_checkpoint
    calls = 0

    def counted(*args, **kwargs):
        nonlocal calls
        calls += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(torch_backend, "load_validated_checkpoint", counted)
    with _client(tmp_path) as client:
        for _ in range(5):
            response = client.get(
                "/api/v2/models/harmonyforge-bimask-base-v1/manifest"
            )
            assert response.status_code == 200
            assert response.json()["available"] is False
            assert client.get("/api/models").status_code == 200

    assert calls == 1
