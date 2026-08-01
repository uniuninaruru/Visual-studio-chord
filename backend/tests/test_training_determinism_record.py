"""The recorded determinism flag must be an observation, not a declaration.

It used to be the constant `True` in the writer while the reader demanded
`True`, so the field was a tautology: it could not be wrong, and it therefore
said nothing. Publishing a manifest instead of weights depends on a third party
recomputing the same checkpoint hash, which only holds if the run really was
reproducible — so the flag has to be able to be false, and false has to mean
something.
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path

import pytest

from app.ml.checkpoint import (
    INFERENCE_TASK,
    PRETRAINING_TASK,
    TRAINING_RUN_SCHEMA_VERSION,
    CheckpointInvalidError,
    load_training_run_contract_bytes,
)
from app.ml.training_runtime import (
    TrainOptions,
    _configure_determinism,
    _recorded_nondeterministic_operations,
)


class _Backends:
    class cudnn:
        benchmark = True
        deterministic = False


class _FakeTorch:
    """Records how use_deterministic_algorithms was asked for."""

    def __init__(self) -> None:
        self.warn_only: bool | None = None
        self.backends = _Backends()

    def manual_seed(self, value: int) -> None:
        self.seed = value

    class _Cuda:
        @staticmethod
        def is_available() -> bool:
            return False

    cuda = _Cuda()

    def use_deterministic_algorithms(self, enabled: bool, warn_only: bool = False):
        assert enabled is True
        self.warn_only = warn_only


def _training_run(**overrides) -> bytes:
    payload = {
        "schemaVersion": TRAINING_RUN_SCHEMA_VERSION,
        "deterministic": True,
        "task": PRETRAINING_TASK,
        "initialCheckpoint": None,
        "sourceCommit": "b" * 40,
        "configSha256": "c" * 64,
        "dataManifestSha256": "d" * 64,
        "pytorchVersion": "2.13.0",
        "cublasWorkspaceConfig": ":4096:8",
        "seed": "1729",
        "optimizer": {"name": "AdamW"},
        "epochs": 1,
        "steps": 3,
        "actualDevice": "cpu",
        "dtype": "float32",
        "fallbackReason": None,
        "meanTrainingLoss": 0.5,
        "metrics": {},
    }
    payload.update(overrides)
    return json.dumps(payload).encode()


def test_strict_mode_asks_torch_to_raise_and_relaxed_mode_asks_it_to_warn() -> None:
    strict, relaxed = _FakeTorch(), _FakeTorch()

    _configure_determinism(strict, "1729", strict=True)
    _configure_determinism(relaxed, "1729", strict=False)

    assert strict.warn_only is False
    assert relaxed.warn_only is True
    # Both modes still request deterministic kernels wherever one exists; they
    # differ only in what happens when none does.
    assert strict.backends.cudnn.deterministic is True
    assert relaxed.backends.cudnn.deterministic is True
    assert relaxed.backends.cudnn.benchmark is False


def test_a_clean_run_records_no_nondeterministic_operations() -> None:
    with _recorded_nondeterministic_operations() as observed:
        warnings.warn("something unrelated", UserWarning, stacklevel=2)

    assert observed == set()


def test_the_operation_torch_names_is_captured() -> None:
    with _recorded_nondeterministic_operations() as observed:
        warnings.warn(
            "index_put_with_accumulate_mps does not have a deterministic "
            "implementation, but you set 'torch.use_deterministic_algorithms("
            "True, warn_only=True)'.",
            UserWarning,
            stacklevel=2,
        )

    assert observed == {"index_put_with_accumulate_mps"}


def test_every_offending_operation_is_captured_not_just_one() -> None:
    with _recorded_nondeterministic_operations() as observed:
        for name in ("index_put_with_accumulate_mps", "scatter_add_cuda_kernel"):
            warnings.warn(
                f"{name} does not have a deterministic implementation, but you "
                f"set 'torch.use_deterministic_algorithms(True)'.",
                UserWarning,
                stacklevel=2,
            )

    assert observed == {"index_put_with_accumulate_mps", "scatter_add_cuda_kernel"}


def test_an_ambient_ignore_filter_cannot_hide_a_nondeterministic_operation() -> None:
    """The dangerous direction: a suppressed warning reads as a clean run.

    `-W ignore`, PYTHONWARNINGS, and a pytest filterwarnings entry all install a
    filter this recorder inherits. Without overriding it the warning is dropped,
    nothing is observed, and the run is recorded as deterministic when it was
    not — turning an environment setting into a false provenance claim. Verified
    against a real MPS kernel under `python -W ignore` before being pinned here.
    """

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        with _recorded_nondeterministic_operations() as observed:
            warnings.warn(
                "index_put_with_accumulate_mps does not have a deterministic "
                "implementation, but you set 'torch.use_deterministic_algorithms"
                "(True, warn_only=True)'.",
                UserWarning,
                stacklevel=2,
            )

    assert observed == {"index_put_with_accumulate_mps"}


def test_opting_into_nondeterminism_is_off_by_default() -> None:
    assert TrainOptions().allow_nondeterministic is False
    TrainOptions(allow_nondeterministic=True).validate()


def test_a_deterministic_run_is_accepted_for_either_task() -> None:
    for task in (PRETRAINING_TASK, INFERENCE_TASK):
        contract = load_training_run_contract_bytes(
            _training_run(deterministic=True, task=task)
        )
        assert contract["deterministic"] is True


def test_a_nondeterministic_run_may_only_produce_a_pretraining_artifact() -> None:
    """The flag has to bite, or making it honest would only be decoration.

    Apple Metal has no deterministic embedding backward, so a non-deterministic
    run is the only way to use that GPU. It stays a local experiment: the
    reproduce-from-recipe claim it cannot support is exactly the one the
    published inference artifact has to make.
    """

    accepted = load_training_run_contract_bytes(
        _training_run(deterministic=False, task=PRETRAINING_TASK)
    )
    assert accepted["deterministic"] is False

    with pytest.raises(CheckpointInvalidError) as error:
        load_training_run_contract_bytes(
            _training_run(deterministic=False, task=INFERENCE_TASK)
        )

    assert PRETRAINING_TASK in str(error.value)


def test_a_legacy_run_cannot_smuggle_nondeterminism_in(tmp_path) -> None:
    """Schema v1 normalizes to the inference task, so false must be refused."""

    legacy = json.loads(_training_run(deterministic=False).decode())
    legacy.pop("task")
    legacy.pop("initialCheckpoint")
    legacy["schemaVersion"] = 1

    with pytest.raises(CheckpointInvalidError):
        load_training_run_contract_bytes(json.dumps(legacy).encode())


def test_a_non_boolean_determinism_flag_is_rejected() -> None:
    for value in ("true", 1, None):
        with pytest.raises(CheckpointInvalidError):
            load_training_run_contract_bytes(_training_run(deterministic=value))


def _small_config(tmp_path):
    """The shipped config with a one-layer body, so a real run is quick.

    Everything else — vocabulary, representation, frame budget — is kept, so the
    compiled fixture rows still validate against it.
    """

    import yaml

    source = (
        Path(__file__).resolve().parents[2]
        / "configs"
        / "models"
        / "harmonyforge-bimask-base-v1.yaml"
    )
    raw = yaml.safe_load(source.read_text(encoding="utf-8"))
    raw["architecture"].update(
        {"layers": 1, "hidden_size": 32, "attention_heads": 4, "feed_forward_size": 64}
    )
    path = tmp_path / "small.yaml"
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    return path


def _harmony_only_dataset(tmp_path):
    from app.ml.dataset import (
        DATA_MANIFEST_FILE,
        PRIVATE_HARMONY_TRAINING_PURPOSE,
        CompileOptions,
        compile_dataset,
    )
    from tests.test_training_dataset import _record, _write_harmony_only_inputs

    # Content has to differ per record: identical harmony is unioned into one
    # work group by duplicate detection, and a single group lands wholly in one
    # split, leaving validation empty and the run refusing to export.
    records = []
    for index in range(24):
        record = _record(
            f"det-{index:03d}",
            root=index % 12,
            quality="major" if index % 2 else "minor",
        )
        record["sourceId"] = f"fixture-{index}"
        record["sourceItemId"] = f"fixture-{index}:det-{index:03d}"
        record.pop("melody", None)
        record.pop("style", None)
        records.append(record)
    input_path, ledger_path = _write_harmony_only_inputs(tmp_path, records)
    output = tmp_path / "compiled"
    compile_dataset(
        input_path,
        ledger_path,
        output,
        options=CompileOptions(
            dataset_id="determinism-fixture",
            dataset_version="v1",
            purpose=PRIVATE_HARMONY_TRAINING_PURPOSE,
            content_profile="harmonyOnlyV1",
            train_basis_points=5_000,
            validation_basis_points=3_000,
        ),
    )
    return output / DATA_MANIFEST_FILE


def _run_training(tmp_path, **overrides):
    from app.ml.training_runtime import TrainOptions, train_reference_model

    return train_reference_model(
        config_path=_small_config(tmp_path),
        data_manifest_path=_harmony_only_dataset(tmp_path),
        model_directory=tmp_path / "models",
        source_commit="a" * 40,
        task=PRETRAINING_TASK,
        # Pinned to CPU: "auto" would pick this machine's accelerator, and the
        # answer to "was the run deterministic" is exactly what varies by device.
        options=TrainOptions(
            batch_size=1, max_steps=1, device="cpu", **overrides
        ),
    )


def _written_training_run(model_directory):
    path = next(model_directory.rglob("training-run.json"))
    return json.loads(path.read_text(encoding="utf-8"))


def test_a_real_run_writes_the_determinism_it_observed(tmp_path) -> None:
    """Ties the observation to the artifact, not just to the helper.

    Testing the recorder and the contract separately leaves the wiring between
    them untested, which is where the constant `True` used to live.
    """

    pytest.importorskip("torch")
    pytest.importorskip("safetensors")

    result = _run_training(tmp_path)

    assert result["deterministic"] is True
    assert result["nondeterministicOperations"] == []
    assert _written_training_run(tmp_path / "models")["deterministic"] is True


def test_an_observed_nondeterministic_operation_reaches_the_artifact(
    tmp_path,
    monkeypatch,
) -> None:
    """The path that matters: what was seen is what gets written down.

    Apple Metal is the real case, but it cannot be required in a test suite, so
    the observation itself is substituted and the artifact is then read back off
    disk to prove the value travelled the whole way.
    """

    pytest.importorskip("torch")
    pytest.importorskip("safetensors")

    from contextlib import contextmanager

    import app.ml.training_runtime as runtime

    @contextmanager
    def observed_one_bad_kernel():
        found = {"index_put_with_accumulate_mps"}
        yield found

    monkeypatch.setattr(
        runtime,
        "_recorded_nondeterministic_operations",
        observed_one_bad_kernel,
    )

    result = _run_training(tmp_path, allow_nondeterministic=True)

    assert result["deterministic"] is False
    assert result["nondeterministicOperations"] == ["index_put_with_accumulate_mps"]
    written = _written_training_run(tmp_path / "models")
    assert written["deterministic"] is False
    assert written["task"] == PRETRAINING_TASK
