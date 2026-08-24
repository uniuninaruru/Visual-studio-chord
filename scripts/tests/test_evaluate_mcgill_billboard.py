from __future__ import annotations

import importlib.util
import json
import hashlib
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT_PATH = Path(__file__).parents[1] / "evaluate-mcgill-billboard.py"
SPEC = importlib.util.spec_from_file_location("evaluate_mcgill_billboard", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def fixture_text() -> str:
    return """# title: Fixture Song
# artist: Fixture Artist
# metre: 4/4
# tonic: C

0.0\tsilence
1.0\tA, intro, | C:maj . . C:maj/5 | G:7 | x2
2.0\t| N . C:maj | D:maj/3 | ->
# tonic: D
# metre: 3/4
3.0\tB, verse, | D:maj | D:maj | E:min | (2/4) F:maj | x2
4.0\tZ, noise
5.0\tC, chorus, | C:1 | C:maj | &pause | G:maj |
6.0\t| C:maj | C:maj |
7.0\tend
"""


def write_dataset(root: Path, songs: dict[str, str] | None = None) -> Path:
    songs = songs or {"0001": fixture_text(), "0002": fixture_text()}
    dataset = root / "McGill-Billboard-v2"
    member_root = dataset / "McGill-Billboard"
    member_root.mkdir(parents=True)
    total = 0
    for identifier, text in songs.items():
        path = member_root / identifier / "salami_chords.txt"
        path.parent.mkdir()
        data = text.encode("utf-8")
        path.write_bytes(data)
        total += len(data)
    receipt = {
        "receiptVersion": 1,
        "dataset": "McGill-Billboard-v2",
        "archiveSha256": MODULE.EXPECTED_ARCHIVE_SHA256,
        "annotationFileCount": len(songs),
        "extractedBytes": total,
        "annotationsOnly": True,
        "audioBundled": False,
        "titlesOrArtistsPublished": False,
    }
    (dataset / MODULE.RECEIPT_NAME).write_text(json.dumps(receipt), encoding="utf-8")
    return dataset


def small_model_payload() -> dict[str, object]:
    source = dict(MODULE.MODEL_SOURCE_EXPECTED)
    orders = {
        "1": {"0:major": 2, "7:major": 2},
        "2": {"0:major>7:major": 1, "7:major>0:major": 1},
        "3": {"0:major>7:major>0:major": 1, "7:major>0:major>7:major": 1},
        "4": {
            "0:major>7:major>0:major>7:major": 1,
            "7:major>0:major>7:major>0:major": 1,
        },
        "5": {
            "0:major>7:major>0:major>7:major>0:major": 1,
            "7:major>0:major>7:major>0:major>7:major": 1,
        },
    }
    return {
        "modelId": MODULE.MODEL_ID,
        "modelVersion": MODULE.MODEL_VERSION,
        "orders": orders,
        "schemaVersion": 1,
        "source": source,
    }


def write_small_model(path: Path) -> str:
    payload = small_model_payload()
    data = json.dumps(
        payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode()
    path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()


class ParserTests(unittest.TestCase):
    def test_official_salami_features_normalize_and_split_context(self) -> None:
        sequences, coverage = MODULE.parse_song_bytes(fixture_text().encode())
        tokens = [token for sequence in sequences for token in sequence.tokens]
        self.assertIn("0:major", tokens)
        self.assertIn("7:dominant7", tokens)
        self.assertIn("2:major", tokens)  # E relative to D after the tonic change.
        self.assertGreaterEqual(coverage.dot_repetitions, 3)
        self.assertGreaterEqual(coverage.phrase_repetitions, 2)
        self.assertEqual(coverage.elision_markers, 1)
        self.assertGreaterEqual(coverage.special_markers, 4)
        self.assertGreaterEqual(coverage.key_changes, 1)
        self.assertGreaterEqual(coverage.meter_changes, 2)
        self.assertGreaterEqual(
            coverage.unsupported_reasons.get("unsupported_quality", 0), 1
        )
        self.assertGreaterEqual(coverage.special_reasons.get("N", 0), 1)
        self.assertGreaterEqual(coverage.special_reasons.get("silence", 0), 1)
        self.assertGreaterEqual(coverage.special_reasons.get("end", 0), 1)
        self.assertNotIn("N", coverage.unsupported_reasons)
        self.assertNotIn("&pause", coverage.unsupported_reasons)
        self.assertGreaterEqual(coverage.sequences, 3)

    def test_section_boundary_is_preserved_without_context_reset(self) -> None:
        text = """# title: Boundary
# artist: Test
# metre: 4/4
# tonic: C
0\tA, intro, | C:maj |
1\tB, verse, | G:maj |
"""
        sequences, _coverage = MODULE.parse_song_bytes(text.encode())
        self.assertEqual(len(sequences), 1)
        self.assertEqual(sequences[0].tokens, ("0:major", "7:major"))
        self.assertEqual(sequences[0].section_boundaries, (True,))

    def test_dot_after_special_or_unsupported_does_not_guess(self) -> None:
        text = """# title: Dot
# artist: Test
# metre: 4/4
# tonic: C
0\tA, intro, | . C:maj | N . C:maj | C:1 . G:maj |
"""
        sequences, coverage = MODULE.parse_song_bytes(text.encode())
        self.assertEqual(
            [sequence.tokens for sequence in sequences],
            [("0:major",), ("0:major",), ("7:major",)],
        )
        self.assertGreaterEqual(
            coverage.unsupported_reasons.get("dot_without_previous", 0), 1
        )
        self.assertGreaterEqual(
            coverage.unsupported_reasons.get("unsupported_quality", 0), 1
        )

    def test_repeat_suffix_does_not_match_saxophone_and_max79_is_bounded(self) -> None:
        text = """# title: Repeat
# artist: Test
# metre: 4/4
# tonic: C
0\tA, intro, | C:maj | x79, saxophone
1\tB, saxophone, | G:maj |
"""
        sequences, coverage = MODULE.parse_song_bytes(text.encode())
        self.assertEqual(coverage.phrase_repetitions, 1)
        self.assertEqual(coverage.normalized_tokens, 2)
        self.assertGreaterEqual(len(sequences), 1)
        too_many = text.replace("x79", "x129")
        with self.assertRaises(MODULE.EvaluationInputError):
            MODULE.parse_song_bytes(too_many.encode())

    def test_train_tokenizer_parity_including_slash_bass(self) -> None:
        labels = [
            ("G:7", "C:maj"),
            ("Bb:maj7/3", "C:min"),
            ("F#:hdim7", "E:min"),
            ("D:maj/3", "C:maj"),
        ]
        for label, key in labels:
            with self.subTest(label=label):
                self.assertEqual(
                    MODULE.chord_token(label, key),
                    MODULE._TRAIN.chord_token(label, key),
                )

    def test_headers_require_presence_but_are_not_returned(self) -> None:
        missing = fixture_text().replace("# artist: Fixture Artist\n", "")
        with self.assertRaisesRegex(MODULE.EvaluationInputError, "required"):
            MODULE.parse_song_bytes(missing.encode())

    def test_corrupt_timestamps_changes_and_z_prefix_fail_closed(self) -> None:
        replacements = (
            "x\tA, intro, | C:maj |",
            "-1\tA, intro, | C:maj |",
            "nan\tA, intro, | C:maj |",
            "1\tA, intro, | C:maj |\n0\tA, intro, | G:maj |",
            "0\tZoo",
            "0\tA, intro, C:maj",
        )
        for replacement in replacements:
            with self.subTest(replacement=replacement):
                text = fixture_text().replace(
                    "0.0\tsilence\n1.0\tA, intro, | C:maj . . C:maj/5 | G:7 | x2",
                    replacement,
                )
                with self.assertRaises(MODULE.EvaluationInputError):
                    MODULE.parse_song_bytes(text.encode())
        for header in ("# tonic: H", "# metre: 0/4"):
            with self.subTest(header=header):
                text = fixture_text().replace("# tonic: C", header)
                with self.assertRaises(MODULE.EvaluationInputError):
                    MODULE.parse_song_bytes(text.encode())

    def test_prime_section_marker_and_phrase_local_dot(self) -> None:
        text = """# title: Boundary
# artist: Test
# metre: 4/4
# tonic: C
0\tA''', intro, | C:maj |
1\tB, verse, | G:maj |
2\t| . C:maj |
"""
        sequences, coverage = MODULE.parse_song_bytes(text.encode())
        self.assertEqual(sequences[0].section_boundaries, (True,))
        self.assertGreaterEqual(
            coverage.unsupported_reasons.get("dot_without_previous", 0), 1
        )


class InputTreeTests(unittest.TestCase):
    def patch_fixture_contract(
        self, song_count: int, bytes_total: int, dataset: Path
    ) -> mock._patch:
        tree_hash = MODULE._portable_tree_hash(
            (
                path.relative_to(dataset).as_posix(),
                path.read_bytes(),
            )
            for path in sorted(dataset.glob("McGill-Billboard/*/salami_chords.txt"))
        )
        all_sequences = []
        try:
            for path in sorted(dataset.glob("McGill-Billboard/*/salami_chords.txt")):
                sequences, _coverage = MODULE.parse_song_bytes(path.read_bytes())
                all_sequences.extend(sequences)
            normalized_hash = MODULE.normalized_evaluation_hash(all_sequences)
        except MODULE.EvaluationInputError:
            normalized_hash = MODULE.EXPECTED_NORMALIZED_EVALUATION_SHA256
        return mock.patch.multiple(
            MODULE,
            EXPECTED_ANNOTATION_FILE_COUNT=song_count,
            EXPECTED_EXTRACTED_BYTES=bytes_total,
            EXPECTED_PORTABLE_SOURCE_SHA256=tree_hash,
            EXPECTED_NORMALIZED_EVALUATION_SHA256=normalized_hash,
        )

    def test_bounded_tree_receipt_and_portable_hash(self) -> None:
        with (
            tempfile.TemporaryDirectory() as first,
            tempfile.TemporaryDirectory() as second,
        ):
            path1 = write_dataset(Path(first))
            path2 = write_dataset(Path(second))
            total = sum(
                path.stat().st_size
                for path in path1.glob("McGill-Billboard/*/salami_chords.txt")
            )
            with self.patch_fixture_contract(2, total, path1):
                parsed1 = MODULE.parse_dataset(path1)
                parsed2 = MODULE.parse_dataset(path2)
            self.assertEqual(
                parsed1.portable_source_sha256, parsed2.portable_source_sha256
            )
            self.assertEqual(
                parsed1.normalized_evaluation_sha256,
                parsed2.normalized_evaluation_sha256,
            )
            self.assertEqual(parsed1.coverage.annotation_slots, 2)

    def test_corrupt_receipt_unexpected_tree_and_symlink_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as first:
            dataset = write_dataset(Path(first), {"0001": fixture_text()})
            total = (dataset / "McGill-Billboard/0001/salami_chords.txt").stat().st_size
            with self.patch_fixture_contract(1, total, dataset):
                (dataset / MODULE.RECEIPT_NAME).write_text("{}", encoding="utf-8")
                with self.assertRaises(MODULE.EvaluationInputError):
                    MODULE.parse_dataset(dataset)

        with tempfile.TemporaryDirectory() as second:
            dataset = write_dataset(Path(second), {"0001": fixture_text()})
            with self.patch_fixture_contract(1, total, dataset):
                (dataset / "unexpected.txt").write_text("x", encoding="utf-8")
                with self.assertRaises(MODULE.EvaluationInputError):
                    MODULE.parse_dataset(dataset)

        with tempfile.TemporaryDirectory() as third:
            dataset = write_dataset(Path(third), {"0001": fixture_text()})
            with self.patch_fixture_contract(1, total, dataset):
                annotation = dataset / "McGill-Billboard/0001/salami_chords.txt"
                replacement = dataset / "replacement.txt"
                replacement.write_text("do not follow", encoding="utf-8")
                annotation.unlink()
                annotation.symlink_to(replacement)
                with self.assertRaises(MODULE.EvaluationInputError):
                    MODULE.parse_dataset(dataset)

    def test_normalized_evaluation_hash_pin_rejects_parser_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            dataset = write_dataset(Path(temporary), {"0001": fixture_text()})
            total = (dataset / "McGill-Billboard/0001/salami_chords.txt").stat().st_size
            with (
                self.patch_fixture_contract(1, total, dataset),
                mock.patch.object(
                    MODULE,
                    "normalized_evaluation_hash",
                    return_value="0" * 64,
                ),
            ):
                with self.assertRaisesRegex(
                    MODULE.EvaluationInputError, "normalized evaluation SHA"
                ):
                    MODULE.parse_dataset(dataset)

    def test_oversize_annotation_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            huge = fixture_text() + (" C:maj" * (MODULE.MAX_MEMBER_BYTES // 2))
            dataset = write_dataset(Path(temporary), {"0001": huge})
            total = (dataset / "McGill-Billboard/0001/salami_chords.txt").stat().st_size
            with (
                self.patch_fixture_contract(1, total, dataset),
                mock.patch.object(MODULE, "MAX_MEMBER_BYTES", 64),
            ):
                with self.assertRaisesRegex(
                    MODULE.EvaluationInputError, "file exceeds|per-file"
                ):
                    MODULE.parse_dataset(dataset)

    def test_oversize_receipt_and_bounded_directory_fail_before_parse(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            dataset = write_dataset(Path(temporary), {"0001": fixture_text()})
            total = (dataset / "McGill-Billboard/0001/salami_chords.txt").stat().st_size
            with (
                self.patch_fixture_contract(1, total, dataset),
                mock.patch.object(MODULE, "MAX_RECEIPT_BYTES", 4),
            ):
                with self.assertRaisesRegex(MODULE.EvaluationInputError, "limit"):
                    MODULE.parse_dataset(dataset)

        with tempfile.TemporaryDirectory() as temporary:
            dataset = write_dataset(
                Path(temporary), {"0001": fixture_text(), "0002": fixture_text()}
            )
            total = sum(
                path.stat().st_size
                for path in dataset.glob("McGill-Billboard/*/salami_chords.txt")
            )
            receipt_path = dataset / MODULE.RECEIPT_NAME
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
            receipt["annotationFileCount"] = 1
            receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
            with self.patch_fixture_contract(1, total, dataset):
                with self.assertRaisesRegex(MODULE.EvaluationInputError, "too many"):
                    MODULE.parse_dataset(dataset)

    def test_parser_uses_the_same_snapshot_when_path_changes_after_read(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            dataset = write_dataset(Path(temporary), {"0001": fixture_text()})
            total = (dataset / "McGill-Billboard/0001/salami_chords.txt").stat().st_size
            original = MODULE._read_regular_snapshot

            def snapshot_then_mutate(path: Path, *, max_bytes: int) -> bytes:
                data = original(path, max_bytes=max_bytes)
                if path.name == MODULE.ANNOTATION_FILENAME:
                    path.write_text(
                        fixture_text().replace("C:maj", "C:1"),
                        encoding="utf-8",
                    )
                return data

            with (
                self.patch_fixture_contract(1, total, dataset),
                mock.patch.object(
                    MODULE,
                    "_read_regular_snapshot",
                    side_effect=snapshot_then_mutate,
                ),
            ):
                parsed = MODULE.parse_dataset(dataset)
            self.assertGreater(parsed.coverage.normalized_tokens, 0)

    def test_hash_does_not_depend_on_absolute_paths_or_expressive_data(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            dataset = write_dataset(Path(temporary), {"0001": fixture_text()})
            total = (dataset / "McGill-Billboard/0001/salami_chords.txt").stat().st_size
            with self.patch_fixture_contract(1, total, dataset):
                parsed = MODULE.parse_dataset(dataset)
            self.assertNotIn(str(Path(temporary)), parsed.normalized_evaluation_sha256)
            self.assertNotIn(
                "Fixture Artist",
                MODULE.normalized_canonical_bytes(parsed.sequences).decode(),
            )
            self.assertNotIn(
                "Fixture Song",
                MODULE.normalized_canonical_bytes(parsed.sequences).decode(),
            )
            self.assertEqual(len(parsed.portable_source_sha256), 64)


class ModelMetricsTests(unittest.TestCase):
    def fixture_model(self, root: Path) -> tuple[Path, mock._patch]:
        path = root / "model.json"
        digest = write_small_model(path)
        patches = mock.patch.multiple(
            MODULE,
            EXPECTED_MODEL_SHA256=digest,
            EXPECTED_MODEL_ORDER_ENTRIES={order: 2 for order in range(1, 6)},
            EXPECTED_MODEL_ORDER_TOTALS={1: 4, 2: 2, 3: 2, 4: 2, 5: 2},
        )
        return path, patches

    def test_tokenizer_model_load_uses_start_snapshot_and_reported_hash(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path, patches = self.fixture_model(Path(temporary))
            original_reader = MODULE._read_regular_snapshot
            tokenizer_path = Path(MODULE.__file__).with_name("train-harmony-corpus.py")
            tokenizer_data = original_reader(
                tokenizer_path, max_bytes=MODULE.MAX_MODEL_BYTES
            )
            expected_hash = hashlib.sha256(tokenizer_data).hexdigest()
            loaded_module, loaded_hash = MODULE._load_training_tokenizer()
            self.assertEqual(loaded_hash, expected_hash)
            self.assertEqual(
                loaded_module.chord_token("G:7", "C:maj"),
                MODULE._TRAIN.chord_token("G:7", "C:maj"),
            )

            def reject_tokenizer_reread(path_arg: Path, *, max_bytes: int) -> bytes:
                if path_arg == tokenizer_path:
                    raise AssertionError("tokenizer was read a second time")
                return original_reader(path_arg, max_bytes=max_bytes)

            with (
                patches,
                mock.patch.object(
                    MODULE,
                    "_read_regular_snapshot",
                    side_effect=reject_tokenizer_reread,
                ),
            ):
                model = MODULE.load_model(path)
            self.assertEqual(model.tokenizer_sha256, expected_hash)

    def test_model_strict_schema_and_sha(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path, patches = self.fixture_model(Path(temporary))
            with patches:
                model = MODULE.load_model(path)
            self.assertEqual(model.model_id, MODULE.MODEL_ID)
            self.assertEqual(len(model.orders[1]), 2)
            path.write_text("{}", encoding="utf-8")
            with patches:
                with self.assertRaises(MODULE.EvaluationInputError):
                    MODULE.load_model(path)

    def test_model_schema_rejects_corruption_even_when_hash_is_rebound(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "model.json"
            base = small_model_payload()
            mutations = []
            extra = json.loads(json.dumps(base))
            extra["unexpected"] = True
            mutations.append(extra)
            bad_source = json.loads(json.dumps(base))
            bad_source["source"]["sequenceCount"] = 999
            mutations.append(bad_source)
            bad_bool = json.loads(json.dumps(base))
            bad_bool["orders"]["1"]["0:major"] = True
            mutations.append(bad_bool)
            bad_gram = json.loads(json.dumps(base))
            bad_gram["orders"]["2"] = {"0:major": 1, "7:major": 1}
            mutations.append(bad_gram)
            for payload in mutations:
                data = json.dumps(
                    payload,
                    ensure_ascii=False,
                    separators=(",", ":"),
                    sort_keys=True,
                ).encode()
                path.write_bytes(data)
                digest = hashlib.sha256(data).hexdigest()
                with self.subTest(payload=payload):
                    with mock.patch.multiple(
                        MODULE,
                        EXPECTED_MODEL_SHA256=digest,
                        EXPECTED_MODEL_ORDER_ENTRIES={
                            order: 2 for order in range(1, 6)
                        },
                        EXPECTED_MODEL_ORDER_TOTALS={1: 4, 2: 2, 3: 2, 4: 2, 5: 2},
                    ):
                        with self.assertRaises(MODULE.EvaluationInputError):
                            MODULE.load_model(path)

    def test_ts_interpolation_unseen_context_and_tie_order(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path, patches = self.fixture_model(Path(temporary))
            with patches:
                model = MODULE.load_model(path)
            scorer = MODULE._ModelScorer(model, 2)
            self.assertAlmostEqual(scorer.probability(("7:major",)), 1 / 2)
            self.assertAlmostEqual(
                scorer.probability(("0:major", "7:major")),
                (1 / 3) * 1 + (2 / 3) * (1 / 2),
            )
            self.assertAlmostEqual(
                scorer.probability(("5:major", "7:major")),
                1 / 2,
            )
            self.assertEqual(
                scorer.rank_candidates(("5:major")), ("0:major", "7:major")
            )

    def test_oov_denominator_topk_ties_and_slice_partition(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path, patches = self.fixture_model(Path(temporary))
            with patches:
                model = MODULE.load_model(path)
            sequences = (
                MODULE.NormalizedSequence(
                    ("0:major", "9:major", "7:major"),
                    (False, True),
                ),
                MODULE.NormalizedSequence(("7:major", "0:major"), (False,)),
            )
            result = MODULE.evaluate_order(sequences, model, 2)
            all_metrics = result["all"]
            self.assertEqual(all_metrics["transitionCount"], 3)
            self.assertEqual(all_metrics["inVocabularyCount"], 2)
            self.assertEqual(all_metrics["oovCount"], 1)
            self.assertEqual(all_metrics["nllDenominator"], 2)
            self.assertEqual(all_metrics["perplexityDenominator"], 2)
            self.assertEqual(all_metrics["top1"]["denominator"], 3)
            self.assertEqual(
                result["withinSection"]["transitionCount"]
                + result["sectionBoundary"]["transitionCount"],
                all_metrics["transitionCount"],
            )
            self.assertEqual(
                result["withinSection"]["top1"]["correct"]
                + result["sectionBoundary"]["top1"]["correct"],
                all_metrics["top1"]["correct"],
            )
            self.assertEqual(sum(all_metrics["effectiveOrderCounts"].values()), 3)
            self.assertEqual(
                all_metrics["nllDenominator"],
                result["withinSection"]["nllDenominator"]
                + result["sectionBoundary"]["nllDenominator"],
            )

    def test_report_is_deterministic_aggregate_only_and_atomic(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dataset = write_dataset(
                root, {"0001": fixture_text(), "0002": fixture_text()}
            )
            model_path, model_patches = self.fixture_model(root)
            total = sum(
                path.stat().st_size
                for path in dataset.glob("McGill-Billboard/*/salami_chords.txt")
            )
            tree_hash = MODULE._portable_tree_hash(
                (
                    path.relative_to(dataset).as_posix(),
                    path.read_bytes(),
                )
                for path in sorted(dataset.glob("McGill-Billboard/*/salami_chords.txt"))
            )
            tree_patches = mock.patch.object(
                MODULE,
                "EXPECTED_PORTABLE_SOURCE_SHA256",
                tree_hash,
            )
            normalized_patches = mock.patch.object(
                MODULE,
                "EXPECTED_NORMALIZED_EVALUATION_SHA256",
                MODULE.normalized_evaluation_hash(
                    tuple(
                        sequence
                        for path in sorted(
                            dataset.glob("McGill-Billboard/*/salami_chords.txt")
                        )
                        for sequence in MODULE.parse_song_bytes(path.read_bytes())[0]
                    )
                ),
            )
            dataset_patches = mock.patch.multiple(
                MODULE,
                EXPECTED_ANNOTATION_FILE_COUNT=2,
                EXPECTED_EXTRACTED_BYTES=total,
            )
            with tree_patches, normalized_patches, dataset_patches, model_patches:
                report1 = MODULE.build_report(
                    dataset, model_path, generated_at="2026-01-01T00:00:00Z"
                )
                report2 = MODULE.build_report(
                    dataset, model_path, generated_at="2026-01-01T00:00:00Z"
                )
            self.assertEqual(report1, report2)
            encoded = json.dumps(report1, sort_keys=True)
            self.assertNotIn("Fixture Song", encoded)
            self.assertNotIn("Fixture Artist", encoded)
            self.assertNotIn(str(root), encoded)
            self.assertFalse(report1["conclusion"]["qualityImprovementClaimed"])
            self.assertTrue(report1["dataset"]["noQualityClaim"])
            self.assertFalse(report1["dataset"]["rawAnnotationsTrackedInRepository"])
            self.assertNotIn("rawAnnotationsBundled", report1["dataset"])
            self.assertNotIn("sourceModelSha256", report1["model"])
            self.assertNotIn("tokenizerScriptSha256", report1["model"])
            self.assertEqual(
                report1["normalization"],
                {
                    "parserVersion": MODULE.PARSER_VERSION,
                    "tokenizerScriptSha256": MODULE.TRAIN_TOKENIZER_SHA256,
                },
            )
            self.assertEqual(
                report1["protocol"]["sectionBoundaryDefinition"],
                {
                    "formalHighLevelSegmentStart": "first valid token after capital letter plus zero or more primes at phrase prefix",
                    "zBehavior": "resetWithoutBoundary",
                    "plainTextLabelsExcluded": True,
                },
            )
            with self.assertRaises(MODULE.EvaluationInputError):
                MODULE._validate_generated_at("2026-01-01T00:00:00+00:00")
            output = root / "report.json"
            output.write_text("old", encoding="utf-8")
            with mock.patch.object(MODULE.os, "replace", side_effect=OSError("disk")):
                with self.assertRaises(OSError):
                    MODULE.atomic_write_json(output, report1)
            self.assertEqual(output.read_text(encoding="utf-8"), "old")


class TrackedReportContractTests(unittest.TestCase):
    """Validate the committed aggregate report without requiring raw data."""

    def test_tracked_report_is_public_aggregate_and_metric_bound(self) -> None:
        repository_root = Path(__file__).parents[2]
        report_path = (
            repository_root
            / "docs/research/evaluations/mcgill-billboard-v2-harmony-language-model-v1.json"
        )
        report = json.loads(report_path.read_text(encoding="utf-8"))
        self.assertEqual(report["schemaVersion"], 1)
        self.assertEqual(report["reportKind"], "externalHarmonyLanguageModelEvaluation")
        self.assertEqual(report["dataset"]["annotationSlots"], 890)
        self.assertEqual(report["coverage"]["transitions"], 79807)
        self.assertEqual(
            report["dataset"]["archiveSha256"], MODULE.EXPECTED_ARCHIVE_SHA256
        )
        self.assertEqual(
            report["dataset"]["portableSourceTreeSha256"],
            MODULE.EXPECTED_PORTABLE_SOURCE_SHA256,
        )
        self.assertEqual(
            report["dataset"]["normalizedEvaluationSha256"],
            MODULE.EXPECTED_NORMALIZED_EVALUATION_SHA256,
        )
        self.assertEqual(
            report["model"]["modelSha256"],
            MODULE.EXPECTED_MODEL_SHA256,
        )
        self.assertNotIn("tokenizerScriptSha256", report["model"])
        self.assertEqual(
            report["normalization"]["parserVersion"], MODULE.PARSER_VERSION
        )
        self.assertEqual(
            report["normalization"]["tokenizerScriptSha256"],
            MODULE.TRAIN_TOKENIZER_SHA256,
        )
        self.assertEqual(
            report["protocol"]["sectionBoundaryDefinition"][
                "formalHighLevelSegmentStart"
            ],
            "first valid token after capital letter plus zero or more primes at phrase prefix",
        )
        self.assertEqual(
            report["protocol"]["sectionBoundaryDefinition"]["zBehavior"],
            "resetWithoutBoundary",
        )
        self.assertTrue(
            report["protocol"]["sectionBoundaryDefinition"]["plainTextLabelsExcluded"]
        )
        self.assertTrue(report["dataset"]["noQualityClaim"])
        self.assertFalse(report["dataset"]["rawAnnotationsTrackedInRepository"])
        self.assertFalse(report["dataset"]["rawSequencesPublished"])
        self.assertFalse(report["dataset"]["audioDistributed"])
        MODULE._validate_generated_at(report["generatedAt"])

        expected_all = {
            "1": (4.7870988083012636, 27.60961390705025, 0.20069668074229077),
            "2": (4.2734057582705915, 19.338523693136526, 0.22897740799679225),
            "3": (4.164230023512828, 17.92908581535047, 0.259313092836468),
        }
        for order, (expected_nll, expected_ppl, expected_top1) in expected_all.items():
            result = report["results"][order]
            all_metrics = result["all"]
            within = result["withinSection"]
            boundary = result["sectionBoundary"]
            self.assertEqual(all_metrics["transitionCount"], 79807)
            self.assertEqual(boundary["transitionCount"], 5160)
            self.assertAlmostEqual(all_metrics["meanNllBits"], expected_nll)
            self.assertAlmostEqual(all_metrics["perplexityBase2"], expected_ppl)
            self.assertAlmostEqual(all_metrics["top1"]["rate"], expected_top1)
            for key in (
                "transitionCount",
                "inVocabularyCount",
                "oovCount",
                "nllDenominator",
                "perplexityDenominator",
            ):
                self.assertEqual(all_metrics[key], within[key] + boundary[key])
            for key in ("top1", "top3", "top5"):
                for field_name in ("correct", "denominator"):
                    self.assertEqual(
                        all_metrics[key][field_name],
                        within[key][field_name] + boundary[key][field_name],
                    )
            for field_name in ("count", "denominator"):
                self.assertEqual(
                    all_metrics["requestedExactSupport"][field_name],
                    within["requestedExactSupport"][field_name]
                    + boundary["requestedExactSupport"][field_name],
                )
            for key in ("1", "2", "3"):
                self.assertEqual(
                    all_metrics["effectiveOrderCounts"][key],
                    within["effectiveOrderCounts"][key]
                    + boundary["effectiveOrderCounts"][key],
                )
            weighted_nll = (
                within["meanNllBits"] * within["nllDenominator"]
                + boundary["meanNllBits"] * boundary["nllDenominator"]
            ) / all_metrics["nllDenominator"]
            self.assertAlmostEqual(all_metrics["meanNllBits"], weighted_nll)
            self.assertAlmostEqual(all_metrics["perplexityBase2"], 2**weighted_nll)

        encoded = report_path.read_text(encoding="utf-8")
        self.assertNotIn("Fixture Song", encoded)
        self.assertNotIn("Fixture Artist", encoded)
        self.assertNotIn("/Users/", encoded)
        self.assertNotIn("/tmp/", encoded)
        self.assertNotIn("title:", encoded)
        self.assertNotIn("artist:", encoded)
        self.assertIsNone(
            re.search(
                r"(?<![\w])(?:[0-9]|1[01]):[A-Za-z][A-Za-z0-9]*(?![\w])",
                encoded,
            )
        )

        def list_paths(value: object, path: tuple[str, ...] = ()):
            if isinstance(value, dict):
                for key, child in value.items():
                    yield from list_paths(child, path + (key,))
            elif isinstance(value, list):
                yield path

        self.assertEqual(list(list_paths(report)), [("model", "runtimeOrders")])


if __name__ == "__main__":
    unittest.main()
