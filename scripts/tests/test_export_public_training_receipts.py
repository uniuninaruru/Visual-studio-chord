from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "export-public-training-receipts.py"
SPEC = importlib.util.spec_from_file_location(
    "export_public_training_receipts",
    SCRIPT_PATH,
)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)
TOKENIZER_SHA256 = "bab9f471275a090fa09256e23103f8cdecd8492e8e708a6ef1560538b6aeaaa9"


def _json_bytes(payload: dict) -> bytes:
    return json.dumps(
        payload,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


class PublicTrainingReceiptTests(unittest.TestCase):
    def _artifact(
        self,
        root: Path,
        *,
        deterministic: bool = True,
        device: str = "cpu",
    ) -> tuple[Path, Path, Path, Path]:
        artifact = root / "private-artifact"
        artifact.mkdir()
        checkpoint = artifact / "harmonyforge-bimask-base-v1.safetensors"
        checkpoint.write_bytes(b"private weights that must not be copied")

        normalized_records_sha256 = "1" * 64
        pop909_commit = "d83e6edba6872a704f5d3b8b32f5cb540088dae6"
        prepare_run = {
            "schemaVersion": 1,
            "preparer": {
                "script": "scripts/prepare-pop909-harmony-only.py",
                "scriptSha256": "e" * 64,
            },
            "source": {
                "sourceId": "pop909",
                "sourceCommit": pop909_commit,
                "sourceMaterialSha256": "f" * 64,
            },
            "reviewedSourceInputs": [
                "harmony",
                "key",
                "meter",
                "beatTiming",
            ],
            "emittedTrainingContent": ["harmony", "key", "meter"],
            "options": {
                "gapPolicy": "reject",
                "compilerHarmonyGapPolicy": "excludeRecord",
                "maximumBarsPerRecord": 128,
                "quantization": {
                    "ppq": 480,
                    "frameTicks": 120,
                    "beatUnit": "quarter",
                    "rounding": "nearestTiesAwayFromZero",
                    "adjacentJitterRepair": ("snapWhenAbsoluteDeltaIsBelowOneFrame"),
                },
            },
            "counts": {
                "discoveredSourceItemCount": 909,
                "eligibleSourceItemCount": 900,
                "excludedSourceItemCount": 9,
                "emittedRecordCount": 909,
            },
            "excludedByReason": {"beatCoverage": 9},
            "normalizedRecordsSha256": normalized_records_sha256,
        }
        prepare_bytes = _json_bytes(prepare_run)
        prepare_path = artifact / "prepare-run.json"
        prepare_path.write_bytes(prepare_bytes)

        data_manifest = {
            "schemaVersion": 2,
            "compilerVersion": "1.2.0",
            "datasetId": "pop909-harmony-only",
            "datasetVersion": pop909_commit,
            "purpose": "privateLocalHarmonyOnlyTraining",
            "deterministic": True,
            "splitBeforeWindowing": True,
            "splitSeed": "1729",
            "splitBasisPoints": {
                "train": 8000,
                "validation": 1000,
                "test": 1000,
            },
            "input": {
                "sha256": normalized_records_sha256,
                "recordCount": 909,
            },
            "ledger": {
                "sha256": "2" * 64,
                "sourceIds": ["pop909"],
                "sourceChecksumScope": "perSourceCanonicalNormalizedRecords",
                "reviewedSourceInputs": [
                    "harmony",
                    "key",
                    "meter",
                    "beatTiming",
                ],
                "emittedTrainingContent": ["harmony", "key", "meter"],
                "preparation": {
                    "schemaVersion": 1,
                    "sha256": _sha256(prepare_bytes),
                },
            },
            "tokenizerSha256": TOKENIZER_SHA256,
            "vocabulary": {
                "file": "vocabulary.json",
                "sha256": "4" * 64,
            },
            "statistics": {
                "file": "statistics.json",
                "sha256": "5" * 64,
            },
            "normalization": {
                "ppq": 480,
                "frame": "sixteenth",
                "rootEncoding": "keyRelativePitchClass",
                "bassEncoding": "rootRelativePitchClass",
                "unsupportedQualityPolicy": "excludeRecord",
                "harmonyGapPolicy": "excludeRecord",
                "normalizedFingerprint": "sha256-relative-harmony-key-meter-v1",
            },
            "splits": {
                name: {
                    "file": {
                        "train": "train.index.jsonl",
                        "validation": "validation.index.jsonl",
                        "test": "test.index.jsonl",
                    }[name],
                    "sha256": str(index) * 64,
                    "windowCount": 10 + index,
                    "recordCount": 8 + index,
                    "splitGroupCount": 7 + index,
                }
                for index, name in enumerate(
                    ("train", "validation", "test"),
                    start=6,
                )
            },
            "assignments": [
                {
                    "recordId": "secret-record-id",
                    "workId": "secret-work-id",
                    "sourceItemId": "secret-source-item-id",
                    "split": "train",
                    "splitGroupId": "secret-group-id",
                }
            ],
            "contentProfile": "harmonyOnlyV1",
            "distributionScope": "privateLocalOnly",
            "provenance": {
                "file": "provenance.json",
                "sha256": "9" * 64,
            },
        }
        data_bytes = _json_bytes(data_manifest)
        data_path = artifact / "data-manifest.json"
        data_path.write_bytes(data_bytes)

        training_run = {
            "schemaVersion": 2,
            "task": "harmony_only_pretraining",
            "deterministic": deterministic,
            "initialCheckpoint": {
                "modelId": "harmonyforge-bimask-base-v1",
                "task": "harmony_only_pretraining",
                "manifestSha256": "c" * 64,
                "checkpointSha256": "d" * 64,
            },
            "sourceCommit": "b" * 40,
            "configSha256": "a" * 64,
            "dataManifestSha256": _sha256(data_bytes),
            "pytorchVersion": "2.13.0",
            "cublasWorkspaceConfig": ":4096:8",
            "seed": "1729",
            "optimizer": {
                "name": "AdamW",
                "learningRate": 0.0001,
                "weightDecay": 0.01,
                "gradientClippingNorm": 1.0,
                "batchSize": 1,
                "maximumSteps": 10,
            },
            "epochs": 1,
            "steps": 10,
            "actualDevice": device,
            "dtype": "float32",
            "fallbackReason": None,
            "meanTrainingLoss": 0.75,
            "metrics": {
                "event": {"count": 32, "nll": 0.5, "accuracy": 0.75},
                "root": {"count": 32, "nll": 0.5, "accuracy": 0.75},
                "quality": {"count": 32, "nll": 0.5, "accuracy": 0.75},
                "inversion": {
                    "count": 32,
                    "nll": 0.5,
                    "accuracy": 0.75,
                },
                "bass": {"count": 32, "nll": 0.5, "accuracy": 0.75},
                "extensions": {
                    "count": 32,
                    "nll": 0.5,
                    "accuracy": 0.75,
                },
                "primaryMeanNormalizedNll": 0.5,
            },
        }
        training_bytes = _json_bytes(training_run)
        training_path = artifact / "training-run.json"
        training_path.write_bytes(training_bytes)

        manifest = {
            "schemaVersion": 1,
            "modelId": "harmonyforge-bimask-base-v1",
            "task": "harmony_only_pretraining",
            "trained": True,
            "evaluationStatus": "researchOnly",
            "architecture": {
                "family": "bidirectional_masked_transformer",
                "layers": 12,
                "hiddenSize": 768,
                "attentionHeads": 12,
                "feedForwardSize": 4096,
                "dropout": 0.1,
                "normalization": "pre_norm",
                "activation": "gelu",
                "positionalEncoding": "learned_window_plus_bar_and_meter",
                "barSummaryTokens": True,
                "maximumBars": 128,
                "maximumFramesPerWindow": 256,
                "factorizedOutputHeads": True,
                "extensionConditioning": True,
            },
            "architectureConfigSha256": "a" * 64,
            "checkpointFile": checkpoint.name,
            "checkpointSha256": _sha256(checkpoint.read_bytes()),
            "dataManifestFile": "data-manifest.json",
            "trainingRunFile": "training-run.json",
            "tokenizerSha256": TOKENIZER_SHA256,
            "dataManifestSha256": _sha256(data_bytes),
            "trainingRunSha256": _sha256(training_bytes),
            "sourceCommit": "b" * 40,
            "pytorchVersion": "2.13.0",
            "minimumAppVersion": "0.4.0",
            "minimumApiVersion": "2",
            "supportedPrecisions": {
                "cuda": ["bfloat16", "float16", "float32"],
                "mps": ["float16", "float32"],
                "cpu": ["bfloat16", "float32"],
            },
        }
        manifest_path = artifact / "manifest.json"
        manifest_path.write_bytes(_json_bytes(manifest))
        return manifest_path, training_path, data_path, prepare_path

    def _export(
        self,
        root: Path,
        *,
        deterministic: bool = True,
        device: str = "cpu",
    ) -> tuple[Path, dict[str, Path]]:
        manifest, training, data, prepare = self._artifact(
            root,
            deterministic=deterministic,
            device=device,
        )
        reports_root = root / "docs" / "model-reports"
        output = reports_root / "fixture-run"
        result = MODULE.export_public_training_receipts(
            manifest,
            training,
            data,
            output,
            prepare_run_path=prepare,
            project_root=root,
            public_reports_root=reports_root,
        )
        return output, result

    def _rewrite_bound_prepare_run(
        self,
        manifest: Path,
        training: Path,
        data: Path,
        prepare: Path,
        payload: dict,
    ) -> None:
        prepare.write_bytes(_json_bytes(payload))
        data_payload = json.loads(data.read_text(encoding="utf-8"))
        data_payload["ledger"]["preparation"]["sha256"] = _sha256(prepare.read_bytes())
        data.write_bytes(_json_bytes(data_payload))
        training_payload = json.loads(training.read_text(encoding="utf-8"))
        training_payload["dataManifestSha256"] = _sha256(data.read_bytes())
        training.write_bytes(_json_bytes(training_payload))
        manifest_payload = json.loads(manifest.read_text(encoding="utf-8"))
        manifest_payload["dataManifestSha256"] = _sha256(data.read_bytes())
        manifest_payload["trainingRunSha256"] = _sha256(training.read_bytes())
        manifest.write_bytes(_json_bytes(manifest_payload))

    def _rebind_data_and_training(
        self,
        manifest: Path,
        training: Path,
        data: Path,
    ) -> None:
        training_payload = json.loads(training.read_text(encoding="utf-8"))
        training_payload["dataManifestSha256"] = _sha256(data.read_bytes())
        training.write_bytes(_json_bytes(training_payload))
        manifest_payload = json.loads(manifest.read_text(encoding="utf-8"))
        manifest_payload["dataManifestSha256"] = _sha256(data.read_bytes())
        manifest_payload["trainingRunSha256"] = _sha256(training.read_bytes())
        manifest.write_bytes(_json_bytes(manifest_payload))

    def test_exports_only_allowlisted_non_reconstructive_receipts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            output, result = self._export(root)

            self.assertEqual(
                set(result),
                {"manifest.json", "training-run.json", "data-manifest.json"},
            )
            self.assertEqual(
                {path.name for path in output.iterdir()},
                {"manifest.json", "training-run.json", "data-manifest.json"},
            )
            receipts = {
                name: json.loads(path.read_text(encoding="utf-8"))
                for name, path in result.items()
            }
            for receipt in receipts.values():
                self.assertEqual(receipt["schemaVersion"], 2)
                self.assertEqual(
                    receipt["integrityScope"],
                    "unsignedInternalConsistency",
                )
                self.assertFalse(receipt["authenticityClaimed"])
                self.assertFalse(receipt["weightsIncludedInThisReceipt"])
                self.assertFalse(receipt["checkpointIncluded"])
                self.assertNotIn("weightsDistributed", receipt)
                self.assertEqual(
                    receipt["artifactBinding"],
                    receipts["manifest.json"]["artifactBinding"],
                )

            public_run = receipts["training-run.json"]
            self.assertEqual(
                public_run["reproducibilityLevel"],
                "deterministicConfigured",
            )
            self.assertFalse(public_run["crossDeviceBitIdentityClaimed"])
            self.assertFalse(public_run["initialCheckpointBindingVerified"])
            self.assertEqual(
                public_run["initialCheckpoint"],
                {
                    "modelId": "harmonyforge-bimask-base-v1",
                    "task": "harmony_only_pretraining",
                    "manifestSha256": "c" * 64,
                    "checkpointSha256": "d" * 64,
                },
            )
            self.assertEqual(
                public_run["runtime"],
                {
                    "framework": "pytorch",
                    "version": "2.13.0",
                    "device": "cpu",
                    "dtype": "float32",
                    "cublasWorkspaceConfig": ":4096:8",
                },
            )
            public_preparation = receipts["data-manifest.json"]["prepareRun"]
            self.assertEqual(
                receipts["data-manifest.json"]["ledger"]["preparation"]["sha256"],
                public_preparation["binding"]["prepareRunSha256"],
            )
            self.assertEqual(
                public_preparation["source"]["sourceCommit"],
                "d83e6edba6872a704f5d3b8b32f5cb540088dae6",
            )
            self.assertEqual(
                public_preparation["normalizedRecordsSha256"],
                "1" * 64,
            )
            self.assertEqual(
                public_preparation["options"]["compilerHarmonyGapPolicy"],
                "excludeRecord",
            )
            self.assertEqual(
                public_preparation["counts"]["emittedRecordCount"],
                909,
            )
            self.assertTrue(
                public_preparation["binding"]["dataManifestDescriptorVerified"]
            )
            self.assertFalse(public_preparation["binding"]["sourceLedgerBytesVerified"])
            self.assertFalse(
                public_preparation["binding"]["preparerScriptBytesVerified"]
            )

            serialized = json.dumps(receipts, sort_keys=True)
            for forbidden in (
                "secret-record-id",
                "secret-work-id",
                "secret-source-item-id",
                "secret-group-id",
                "private-source-id",
                "excludedByReason",
                "/private/",
                "assignments",
                "checkpointFile",
                "dataManifestFile",
                "trainingRunFile",
            ):
                self.assertNotIn(forbidden, serialized)
            self.assertEqual(list(output.glob("*.safetensors")), [])
            self.assertEqual(list(output.glob(".*.tmp")), [])

    def test_non_deterministic_run_is_rejected_like_the_runtime_contract(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest, training, data, prepare = self._artifact(
                root,
                deterministic=False,
                device="mps",
            )
            reports_root = root / "docs" / "model-reports"

            with self.assertRaisesRegex(
                MODULE.ReceiptExportError,
                "must be deterministic",
            ):
                MODULE.export_public_training_receipts(
                    manifest,
                    training,
                    data,
                    reports_root / "non-deterministic",
                    prepare_run_path=prepare,
                    project_root=root,
                    public_reports_root=reports_root,
                )

    def test_mps_reports_only_determinism_configuration_without_rerun_evidence(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output, _ = self._export(
                Path(temporary_directory),
                deterministic=True,
                device="mps",
            )
            public_run = json.loads(
                (output / "training-run.json").read_text(encoding="utf-8")
            )

            self.assertTrue(public_run["deterministic"])
            self.assertEqual(
                public_run["reproducibilityLevel"],
                "deterministicConfigured",
            )
            self.assertFalse(public_run["crossDeviceBitIdentityClaimed"])
            self.assertEqual(public_run["runtime"]["device"], "mps")

    def test_relative_cli_inputs_resolve_from_invocation_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            invocation_directory = Path(temporary_directory)

            self.assertEqual(
                MODULE._resolve_cli_input(
                    Path("private/manifest.json"),
                    invocation_directory,
                ),
                (invocation_directory / "private" / "manifest.json").resolve(),
            )

    def test_refuses_any_hash_binding_or_checkpoint_mismatch(self) -> None:
        mutations = (
            ("training run", "training-run.json"),
            ("data manifest", "data-manifest.json"),
            ("preparation run", "prepare-run.json"),
            (
                "checkpoint",
                "harmonyforge-bimask-base-v1.safetensors",
            ),
        )
        for label, file_name in mutations:
            with (
                self.subTest(label=label),
                tempfile.TemporaryDirectory() as temporary_directory,
            ):
                root = Path(temporary_directory)
                manifest, training, data, prepare = self._artifact(root)
                (manifest.parent / file_name).write_bytes(b"tampered")
                reports_root = root / "docs" / "model-reports"

                with self.assertRaises(MODULE.ReceiptExportError):
                    MODULE.export_public_training_receipts(
                        manifest,
                        training,
                        data,
                        reports_root / "tampered",
                        prepare_run_path=prepare,
                        project_root=root,
                        public_reports_root=reports_root,
                    )

    def test_refuses_cross_contract_task_and_tokenizer_mismatches(self) -> None:
        for field in ("task", "tokenizer"):
            with (
                self.subTest(field=field),
                tempfile.TemporaryDirectory() as temporary_directory,
            ):
                root = Path(temporary_directory)
                manifest, training, data, prepare = self._artifact(root)
                if field == "task":
                    run = json.loads(training.read_text(encoding="utf-8"))
                    run["task"] = "melody_conditioned_variable_rhythm_harmonization"
                    training.write_bytes(_json_bytes(run))
                    artifact_manifest = json.loads(manifest.read_text(encoding="utf-8"))
                    artifact_manifest["trainingRunSha256"] = _sha256(
                        training.read_bytes()
                    )
                    manifest.write_bytes(_json_bytes(artifact_manifest))
                else:
                    dataset = json.loads(data.read_text(encoding="utf-8"))
                    dataset["tokenizerSha256"] = "f" * 64
                    data.write_bytes(_json_bytes(dataset))
                    run = json.loads(training.read_text(encoding="utf-8"))
                    run["dataManifestSha256"] = _sha256(data.read_bytes())
                    training.write_bytes(_json_bytes(run))
                    artifact_manifest = json.loads(manifest.read_text(encoding="utf-8"))
                    artifact_manifest["dataManifestSha256"] = _sha256(data.read_bytes())
                    artifact_manifest["trainingRunSha256"] = _sha256(
                        training.read_bytes()
                    )
                    manifest.write_bytes(_json_bytes(artifact_manifest))
                reports_root = root / "docs" / "model-reports"

                with self.assertRaises(MODULE.ReceiptExportError):
                    MODULE.export_public_training_receipts(
                        manifest,
                        training,
                        data,
                        reports_root / field,
                        prepare_run_path=prepare,
                        project_root=root,
                        public_reports_root=reports_root,
                    )

    def test_refuses_prepare_values_not_bound_to_compiled_data(self) -> None:
        mutations = {
            "normalized records": (
                lambda payload: payload.__setitem__(
                    "normalizedRecordsSha256",
                    "0" * 64,
                ),
                "different normalized records",
            ),
            "source commit": (
                lambda payload: payload["source"].__setitem__(
                    "sourceCommit",
                    "a" * 40,
                ),
                "different source commits",
            ),
            "preparer path": (
                lambda payload: payload["preparer"].__setitem__(
                    "script",
                    "/private/unreviewed.py",
                ),
                "preparer script is invalid",
            ),
        }
        for label, (mutate, message) in mutations.items():
            with (
                self.subTest(label=label),
                tempfile.TemporaryDirectory() as temporary_directory,
            ):
                root = Path(temporary_directory)
                manifest, training, data, prepare = self._artifact(root)
                payload = json.loads(prepare.read_text(encoding="utf-8"))
                mutate(payload)
                self._rewrite_bound_prepare_run(
                    manifest,
                    training,
                    data,
                    prepare,
                    payload,
                )
                reports_root = root / "docs" / "model-reports"

                with self.assertRaisesRegex(
                    MODULE.ReceiptExportError,
                    message,
                ):
                    MODULE.export_public_training_receipts(
                        manifest,
                        training,
                        data,
                        reports_root / "invalid-preparation",
                        prepare_run_path=prepare,
                        project_root=root,
                        public_reports_root=reports_root,
                    )

    def test_rejects_path_values_after_attackers_rebind_all_hashes(self) -> None:
        cases = {
            "datasetId": (
                "dataset",
                "/Users/example/private-corpus",
                "ASCII safe token",
            ),
            "sourceChecksumScope": (
                "ledger",
                "/Users/example/private-scope",
                "sourceChecksumScope is invalid",
            ),
            "seed": (
                "training",
                r"C:\Users\example\private-seed",
                "ASCII safe token",
            ),
        }
        for field, (target, secret, message) in cases.items():
            with (
                self.subTest(field=field),
                tempfile.TemporaryDirectory() as temporary_directory,
            ):
                root = Path(temporary_directory)
                manifest, training, data, prepare = self._artifact(root)
                if target == "training":
                    run = json.loads(training.read_text(encoding="utf-8"))
                    run[field] = secret
                    training.write_bytes(_json_bytes(run))
                    artifact_manifest = json.loads(manifest.read_text(encoding="utf-8"))
                    artifact_manifest["trainingRunSha256"] = _sha256(
                        training.read_bytes()
                    )
                    manifest.write_bytes(_json_bytes(artifact_manifest))
                else:
                    dataset = json.loads(data.read_text(encoding="utf-8"))
                    if target == "dataset":
                        dataset[field] = secret
                    else:
                        dataset["ledger"][field] = secret
                    data.write_bytes(_json_bytes(dataset))
                    self._rebind_data_and_training(
                        manifest,
                        training,
                        data,
                    )
                reports_root = root / "docs" / "model-reports"
                output = reports_root / f"unsafe-{field}"

                with self.assertRaisesRegex(
                    MODULE.ReceiptExportError,
                    message,
                ):
                    MODULE.export_public_training_receipts(
                        manifest,
                        training,
                        data,
                        output,
                        prepare_run_path=prepare,
                        project_root=root,
                        public_reports_root=reports_root,
                    )

                self.assertFalse(output.exists())

    def test_rejects_nonallowlisted_artifact_filename(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest, training, data, prepare = self._artifact(root)
            artifact_manifest = json.loads(manifest.read_text(encoding="utf-8"))
            artifact_manifest["checkpointFile"] = "alternate.safetensors"
            manifest.write_bytes(_json_bytes(artifact_manifest))
            reports_root = root / "docs" / "model-reports"

            with self.assertRaisesRegex(
                MODULE.ReceiptExportError,
                "checkpointFile is not allowlisted",
            ):
                MODULE.export_public_training_receipts(
                    manifest,
                    training,
                    data,
                    reports_root / "alternate-filename",
                    prepare_run_path=prepare,
                    project_root=root,
                    public_reports_root=reports_root,
                )

    def test_rejects_extra_artifact_manifest_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest, training, data, prepare = self._artifact(root)
            artifact_manifest = json.loads(manifest.read_text(encoding="utf-8"))
            artifact_manifest["diagnosticsPath"] = "/Users/example/private"
            manifest.write_bytes(_json_bytes(artifact_manifest))
            reports_root = root / "docs" / "model-reports"

            with self.assertRaisesRegex(
                MODULE.ReceiptExportError,
                "artifact manifest fields do not match schema v1",
            ):
                MODULE.export_public_training_receipts(
                    manifest,
                    training,
                    data,
                    reports_root / "extra-manifest-field",
                    prepare_run_path=prepare,
                    project_root=root,
                    public_reports_root=reports_root,
                )

    def test_rejects_impossible_metrics_after_hash_rebinding(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest, training, data, prepare = self._artifact(root)
            run = json.loads(training.read_text(encoding="utf-8"))
            run["metrics"]["event"] = {
                "count": 0,
                "nll": -999,
                "accuracy": 42,
            }
            run["metrics"]["primaryMeanNormalizedNll"] = -999
            training.write_bytes(_json_bytes(run))
            artifact_manifest = json.loads(manifest.read_text(encoding="utf-8"))
            artifact_manifest["trainingRunSha256"] = _sha256(training.read_bytes())
            manifest.write_bytes(_json_bytes(artifact_manifest))
            reports_root = root / "docs" / "model-reports"
            output = reports_root / "impossible-metrics"

            with self.assertRaisesRegex(
                MODULE.ReceiptExportError,
                "must use null nll and accuracy when count is zero",
            ):
                MODULE.export_public_training_receipts(
                    manifest,
                    training,
                    data,
                    output,
                    prepare_run_path=prepare,
                    project_root=root,
                    public_reports_root=reports_root,
                )

            self.assertFalse(output.exists())

    def test_metric_boundary_values_match_runtime_semantics(self) -> None:
        empty_metrics = {
            head: {"count": 0, "nll": None, "accuracy": None}
            for head in MODULE.METRIC_HEADS
        }
        empty_metrics["primaryMeanNormalizedNll"] = None

        self.assertEqual(
            MODULE._public_metrics(empty_metrics, "metrics"),
            empty_metrics,
        )

        boundary_metrics = {
            "event": {"count": 1, "nll": 0, "accuracy": 1},
            **{
                head: {"count": 1, "nll": 0, "accuracy": 0}
                for head in MODULE.METRIC_HEADS
                if head != "event"
            },
            "primaryMeanNormalizedNll": 0,
        }
        self.assertEqual(
            MODULE._public_metrics(boundary_metrics, "metrics"),
            boundary_metrics,
        )

    def test_metrics_reject_each_out_of_range_aggregate(self) -> None:
        baseline = {
            head: {"count": 1, "nll": 0.5, "accuracy": 0.5}
            for head in MODULE.METRIC_HEADS
        }
        baseline["primaryMeanNormalizedNll"] = 0.5
        mutations = {
            "negative nll": (
                lambda metrics: metrics["event"].__setitem__("nll", -0.1),
                "event.nll must be finite",
            ),
            "accuracy above one": (
                lambda metrics: metrics["event"].__setitem__(
                    "accuracy",
                    1.01,
                ),
                "event.accuracy must be finite",
            ),
            "negative primary": (
                lambda metrics: metrics.__setitem__(
                    "primaryMeanNormalizedNll",
                    -0.1,
                ),
                "primaryMeanNormalizedNll must be finite",
            ),
            "inconsistent primary": (
                lambda metrics: metrics.__setitem__(
                    "primaryMeanNormalizedNll",
                    0.4,
                ),
                "does not match the mean",
            ),
        }
        for label, (mutate, message) in mutations.items():
            with self.subTest(label=label):
                metrics = json.loads(json.dumps(baseline))
                mutate(metrics)
                with self.assertRaisesRegex(
                    MODULE.ReceiptExportError,
                    message,
                ):
                    MODULE._public_metrics(metrics, "metrics")

    def test_legacy_v1_training_run_is_exported_as_inference_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest, training, data, prepare = self._artifact(root)
            dataset = json.loads(data.read_text(encoding="utf-8"))
            dataset["schemaVersion"] = 1
            dataset["compilerVersion"] = "1.1.0"
            dataset["purpose"] = "researchTraining"
            dataset["normalization"]["normalizedFingerprint"] = (
                "sha256-relative-melody-harmony-v1"
            )
            dataset["ledger"]["sourceChecksumScope"] = "completeCompilerInputJsonlBytes"
            dataset["ledger"].pop("preparation")
            dataset["ledger"].pop("reviewedSourceInputs")
            dataset["ledger"].pop("emittedTrainingContent")
            dataset.pop("contentProfile")
            dataset.pop("distributionScope")
            dataset.pop("provenance")
            data.write_bytes(_json_bytes(dataset))
            prepare.unlink()
            run = json.loads(training.read_text(encoding="utf-8"))
            run["schemaVersion"] = 1
            run["dataManifestSha256"] = _sha256(data.read_bytes())
            run.pop("task")
            run.pop("initialCheckpoint")
            training.write_bytes(_json_bytes(run))
            artifact_manifest = json.loads(manifest.read_text(encoding="utf-8"))
            artifact_manifest["task"] = (
                "melody_conditioned_variable_rhythm_harmonization"
            )
            artifact_manifest["dataManifestSha256"] = _sha256(data.read_bytes())
            artifact_manifest["trainingRunSha256"] = _sha256(training.read_bytes())
            manifest.write_bytes(_json_bytes(artifact_manifest))
            reports_root = root / "docs" / "model-reports"
            output = reports_root / "legacy"

            MODULE.export_public_training_receipts(
                manifest,
                training,
                data,
                output,
                project_root=root,
                public_reports_root=reports_root,
            )

            public_run = json.loads(
                (output / "training-run.json").read_text(encoding="utf-8")
            )
            self.assertEqual(public_run["sourceSchemaVersion"], 1)
            self.assertEqual(
                public_run["task"],
                "melody_conditioned_variable_rhythm_harmonization",
            )
            self.assertIsNone(public_run["initialCheckpoint"])
            public_data = json.loads(
                (output / "data-manifest.json").read_text(encoding="utf-8")
            )
            self.assertIsNone(public_data["prepareRun"])
            self.assertEqual(
                public_data["preparationBinding"],
                {
                    "prepareRunIncluded": False,
                    "dataManifestDescriptorPresent": False,
                    "dataManifestDescriptorVerified": False,
                },
            )
            self.assertNotIn("preparation", public_data["ledger"])
            self.assertNotIn(
                "prepareRunSha256",
                public_data["artifactBinding"],
            )

    def test_schema_v2_harmony_data_requires_prepare_run_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest, training, data, _ = self._artifact(root)
            reports_root = root / "docs" / "model-reports"

            with self.assertRaisesRegex(
                MODULE.ReceiptExportError,
                "schema v2 harmony-only data requires --prepare-run",
            ):
                MODULE.export_public_training_receipts(
                    manifest,
                    training,
                    data,
                    reports_root / "missing-prepare-run",
                    project_root=root,
                    public_reports_root=reports_root,
                )

    def test_schema_v1_melody_data_rejects_prepare_run_input(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest, training, data, prepare = self._artifact(root)
            dataset = json.loads(data.read_text(encoding="utf-8"))
            dataset["schemaVersion"] = 1
            dataset["compilerVersion"] = "1.1.0"
            dataset["purpose"] = "researchTraining"
            dataset["normalization"]["normalizedFingerprint"] = (
                "sha256-relative-melody-harmony-v1"
            )
            dataset["ledger"]["sourceChecksumScope"] = "completeCompilerInputJsonlBytes"
            dataset["ledger"].pop("preparation")
            dataset["ledger"].pop("reviewedSourceInputs")
            dataset["ledger"].pop("emittedTrainingContent")
            dataset.pop("contentProfile")
            dataset.pop("distributionScope")
            dataset.pop("provenance")
            data.write_bytes(_json_bytes(dataset))
            reports_root = root / "docs" / "model-reports"

            with self.assertRaisesRegex(
                MODULE.ReceiptExportError,
                "schema v1 melody-conditioned data must not use --prepare-run",
            ):
                MODULE.export_public_training_receipts(
                    manifest,
                    training,
                    data,
                    reports_root / "ambiguous-legacy-prepare-run",
                    prepare_run_path=prepare,
                    project_root=root,
                    public_reports_root=reports_root,
                )

    def test_rejects_v1_schema_with_v2_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest, training, data, prepare = self._artifact(root)
            run = json.loads(training.read_text(encoding="utf-8"))
            run["schemaVersion"] = 1
            training.write_bytes(_json_bytes(run))
            artifact_manifest = json.loads(manifest.read_text(encoding="utf-8"))
            artifact_manifest["trainingRunSha256"] = _sha256(training.read_bytes())
            manifest.write_bytes(_json_bytes(artifact_manifest))
            reports_root = root / "docs" / "model-reports"

            with self.assertRaisesRegex(
                MODULE.ReceiptExportError,
                "legacy training run fields",
            ):
                MODULE.export_public_training_receipts(
                    manifest,
                    training,
                    data,
                    reports_root / "invalid-v1",
                    prepare_run_path=prepare,
                    project_root=root,
                    public_reports_root=reports_root,
                )

    def test_rejects_unknown_training_task(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest, training, data, prepare = self._artifact(root)
            run = json.loads(training.read_text(encoding="utf-8"))
            run["task"] = "unknown_objective"
            training.write_bytes(_json_bytes(run))
            artifact_manifest = json.loads(manifest.read_text(encoding="utf-8"))
            artifact_manifest["task"] = "unknown_objective"
            artifact_manifest["trainingRunSha256"] = _sha256(training.read_bytes())
            manifest.write_bytes(_json_bytes(artifact_manifest))
            reports_root = root / "docs" / "model-reports"

            with self.assertRaisesRegex(
                MODULE.ReceiptExportError,
                "task is invalid",
            ):
                MODULE.export_public_training_receipts(
                    manifest,
                    training,
                    data,
                    reports_root / "unknown-task",
                    prepare_run_path=prepare,
                    project_root=root,
                    public_reports_root=reports_root,
                )

    def test_rejects_consistent_relabel_against_the_data_profile(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest, training, data, prepare = self._artifact(root)
            run = json.loads(training.read_text(encoding="utf-8"))
            run["task"] = "melody_conditioned_variable_rhythm_harmonization"
            training.write_bytes(_json_bytes(run))
            artifact_manifest = json.loads(manifest.read_text(encoding="utf-8"))
            artifact_manifest["task"] = (
                "melody_conditioned_variable_rhythm_harmonization"
            )
            artifact_manifest["trainingRunSha256"] = _sha256(training.read_bytes())
            manifest.write_bytes(_json_bytes(artifact_manifest))
            reports_root = root / "docs" / "model-reports"

            with self.assertRaisesRegex(
                MODULE.ReceiptExportError,
                "content profile",
            ):
                MODULE.export_public_training_receipts(
                    manifest,
                    training,
                    data,
                    reports_root / "relabelled",
                    prepare_run_path=prepare,
                    project_root=root,
                    public_reports_root=reports_root,
                )

    def test_rejects_impossible_initial_checkpoint_transition(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest, training, data, prepare = self._artifact(root)
            run = json.loads(training.read_text(encoding="utf-8"))
            run["initialCheckpoint"]["task"] = (
                "melody_conditioned_variable_rhythm_harmonization"
            )
            training.write_bytes(_json_bytes(run))
            artifact_manifest = json.loads(manifest.read_text(encoding="utf-8"))
            artifact_manifest["trainingRunSha256"] = _sha256(training.read_bytes())
            manifest.write_bytes(_json_bytes(artifact_manifest))
            reports_root = root / "docs" / "model-reports"

            with self.assertRaisesRegex(
                MODULE.ReceiptExportError,
                "task transition",
            ):
                MODULE.export_public_training_receipts(
                    manifest,
                    training,
                    data,
                    reports_root / "impossible-transition",
                    prepare_run_path=prepare,
                    project_root=root,
                    public_reports_root=reports_root,
                )

    def test_refuses_private_or_non_report_output_directories(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            reports_root = root / "docs" / "model-reports"
            forbidden = (
                root / "models" / "public",
                root / "datasets" / "public",
                root / "training" / "runs" / "public",
                root / "elsewhere",
            )
            for output in forbidden:
                with (
                    self.subTest(output=output),
                    self.assertRaises(MODULE.ReceiptExportError),
                ):
                    MODULE._validate_output_directory(
                        output,
                        project_root=root,
                        public_reports_root=reports_root,
                    )

    def test_refuses_record_level_content_disguised_as_metrics(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest, training, data, prepare = self._artifact(root)
            run = json.loads(training.read_text(encoding="utf-8"))
            run["metrics"]["recordValues"] = [60, 64, 67]
            training.write_bytes(_json_bytes(run))
            artifact_manifest = json.loads(manifest.read_text(encoding="utf-8"))
            artifact_manifest["trainingRunSha256"] = _sha256(training.read_bytes())
            manifest.write_bytes(_json_bytes(artifact_manifest))
            reports_root = root / "docs" / "model-reports"

            with self.assertRaisesRegex(
                MODULE.ReceiptExportError,
                "not approved for publication",
            ):
                MODULE.export_public_training_receipts(
                    manifest,
                    training,
                    data,
                    reports_root / "unsafe-metrics",
                    prepare_run_path=prepare,
                    project_root=root,
                    public_reports_root=reports_root,
                )

    def test_existing_nonempty_receipt_directory_is_never_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            output, _ = self._export(root)
            (output / "manifest.json").write_text("stale", encoding="utf-8")
            manifest, training, data, prepare = (
                root / "private-artifact" / "manifest.json",
                root / "private-artifact" / "training-run.json",
                root / "private-artifact" / "data-manifest.json",
                root / "private-artifact" / "prepare-run.json",
            )

            with self.assertRaisesRegex(
                MODULE.ReceiptExportError,
                "already exists and is not empty",
            ):
                MODULE.export_public_training_receipts(
                    manifest,
                    training,
                    data,
                    output,
                    prepare_run_path=prepare,
                    project_root=root,
                    public_reports_root=root / "docs" / "model-reports",
                )

            self.assertEqual(
                (output / "manifest.json").read_text(encoding="utf-8"),
                "stale",
            )
            self.assertEqual(list(output.glob(".*.tmp")), [])

    def test_empty_output_directory_can_be_atomically_installed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest, training, data, prepare = self._artifact(root)
            reports_root = root / "docs" / "model-reports"
            output = reports_root / "empty"
            output.mkdir(parents=True)

            result = MODULE.export_public_training_receipts(
                manifest,
                training,
                data,
                output,
                prepare_run_path=prepare,
                project_root=root,
                public_reports_root=reports_root,
            )

            self.assertEqual(
                set(result),
                {
                    "manifest.json",
                    "training-run.json",
                    "data-manifest.json",
                },
            )
            self.assertEqual(
                {path.name for path in output.iterdir()},
                set(result),
            )

    def test_readback_failure_does_not_publish_a_partial_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest, training, data, prepare = self._artifact(root)
            reports_root = root / "docs" / "model-reports"
            output = reports_root / "readback-failure"

            with (
                mock.patch.object(
                    MODULE,
                    "_verify_staged_receipt_bundle",
                    side_effect=MODULE.ReceiptExportError("simulated readback failure"),
                ),
                self.assertRaisesRegex(
                    MODULE.ReceiptExportError,
                    "simulated readback failure",
                ),
            ):
                MODULE.export_public_training_receipts(
                    manifest,
                    training,
                    data,
                    output,
                    prepare_run_path=prepare,
                    project_root=root,
                    public_reports_root=reports_root,
                )

            self.assertFalse(output.exists())
            self.assertEqual(
                list(reports_root.glob(f".{output.name}.*.tmp")),
                [],
            )

    def test_cli_describes_only_unsigned_manifest_byte_matching(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "receipt"
            destinations = {
                "manifest.json": output / "manifest.json",
                "training-run.json": output / "training-run.json",
                "data-manifest.json": output / "data-manifest.json",
            }
            stdout = io.StringIO()

            with (
                mock.patch.object(
                    MODULE,
                    "export_public_training_receipts",
                    return_value=destinations,
                ),
                redirect_stdout(stdout),
            ):
                result = MODULE.main(
                    [
                        "--manifest",
                        "private/manifest.json",
                        "--training-run",
                        "private/training-run.json",
                        "--data-manifest",
                        "private/data-manifest.json",
                        "--prepare-run",
                        "private/prepare-run.json",
                        "--output-dir",
                        "docs/model-reports/fixture",
                    ]
                )

            message = stdout.getvalue()
            self.assertEqual(result, 0)
            self.assertIn(
                "Checkpoint bytes matched the supplied unsigned manifest",
                message,
            )
            self.assertNotIn("Checkpoint verified locally", message)

    def test_cli_can_omit_prepare_run_for_legacy_data(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "receipt"
            destinations = {"manifest.json": output / "manifest.json"}
            stdout = io.StringIO()

            with (
                mock.patch.object(
                    MODULE,
                    "export_public_training_receipts",
                    return_value=destinations,
                ) as exporter,
                redirect_stdout(stdout),
            ):
                result = MODULE.main(
                    [
                        "--manifest",
                        "private/manifest.json",
                        "--training-run",
                        "private/training-run.json",
                        "--data-manifest",
                        "private/data-manifest.json",
                        "--output-dir",
                        "docs/model-reports/legacy",
                    ]
                )

            self.assertEqual(result, 0)
            self.assertIsNone(exporter.call_args.kwargs["prepare_run_path"])


if __name__ == "__main__":
    unittest.main()
