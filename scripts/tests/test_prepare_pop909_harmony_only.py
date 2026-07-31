from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "prepare-pop909-harmony-only.py"
REPOSITORY_ROOT = SCRIPT_PATH.parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "backend"))
SPEC = importlib.util.spec_from_file_location(
    "prepare_pop909_harmony_only",
    SCRIPT_PATH,
)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)

from app.ml.dataset import (  # noqa: E402
    PRIVATE_HARMONY_TRAINING_PURPOSE,
    CompileOptions,
    DatasetCompileError,
    compile_dataset,
)


def write_song(
    root: Path,
    song_id: str,
    *,
    beats: str | None = None,
    chords: str | None = None,
    keys: str | None = None,
) -> Path:
    song = root / "POP909" / song_id
    song.mkdir(parents=True)
    (song / "beat_audio.txt").write_text(
        beats
        or "0 1.0\n1 2.0\n2 3.0\n3 4.0\n"
        "4 1.0\n5 2.0\n6 3.0\n7 4.0\n8 1.0\n",
        encoding="utf-8",
    )
    (song / "chord_audio.txt").write_text(
        chords
        or "0 2 C:maj\n"
        "2 4 G:7\n"
        "4 6 A:min7\n"
        "6 8 E:7\n",
        encoding="utf-8",
    )
    (song / "key_audio.txt").write_text(
        keys or "0 4 C:maj\n4 8 A:min\n",
        encoding="utf-8",
    )
    # Prove the preparer does not inspect these payloads.
    (song / f"{song_id}.mid").write_bytes(b"private-midi")
    (song / "audio.wav").write_bytes(b"private-audio")
    return song


class Pop909HarmonyOnlyPreparationTests(unittest.TestCase):
    def test_cli_requires_explicit_source_approval_metadata(self) -> None:
        parser = MODULE.build_argument_parser()
        base_arguments = [
            "--pop909",
            "/private/pop909",
            "--output-records",
            "/private/records.jsonl",
            "--output-ledger",
            "/private/ledger.json",
            "--retrieved-at-utc",
            "2026-07-30T00:00:00Z",
        ]
        with (
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit),
        ):
            parser.parse_args(base_arguments)

        license_arguments = parser.parse_args(
            [
                *base_arguments,
                "--review-basis",
                "license",
                "--reviewed-at-utc",
                "2026-07-30T00:00:00Z",
                "--confirm-source-approved",
            ]
        )
        with (
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit),
        ):
            MODULE.validate_approval_arguments(parser, license_arguments)

        public_domain_arguments = parser.parse_args(
            [
                *base_arguments,
                "--review-basis",
                "publicDomain",
                "--reviewed-at-utc",
                "2026-07-30T01:00:00Z",
                "--confirm-source-approved",
            ]
        )
        MODULE.validate_approval_arguments(parser, public_domain_arguments)
        self.assertIsNone(public_domain_arguments.license_id)
        help_text = parser.format_help()
        self.assertIn("--confirm-source-approved", help_text)
        self.assertIn("--review-basis", help_text)
        self.assertIn("--reviewed-at-utc", help_text)
        self.assertIn("--output-prepare-run", help_text)
        self.assertIn("40-character POP909 Git commit", help_text)

    def test_pop909_source_version_requires_a_full_git_commit(self) -> None:
        with self.assertRaises(MODULE.PreparationError) as raised:
            MODULE.validate_source_commit("d83e6ed")
        self.assertIn("full 40-character", str(raised.exception))

        self.assertEqual(
            MODULE.validate_source_commit(
                "D83E6EDBA6872A704F5D3B8B32F5CB540088DAE6"
            ),
            "d83e6edba6872a704f5d3b8b32f5cb540088dae6",
        )

    def test_cli_writes_hash_bound_prepare_run_beside_ledger(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            write_song(root, "001")
            output = root / "private-output"
            records_path = output / "records.jsonl"
            ledger_path = output / "ledger.json"
            stdout = io.StringIO()

            with contextlib.redirect_stdout(stdout):
                result = MODULE.main(
                    [
                        "--pop909",
                        str(root),
                        "--output-records",
                        str(records_path),
                        "--output-ledger",
                        str(ledger_path),
                        "--source-version",
                        "d83e6edba6872a704f5d3b8b32f5cb540088dae6",
                        "--retrieved-at-utc",
                        "2026-07-30T00:00:00Z",
                        "--review-basis",
                        "publicDomain",
                        "--reviewed-at-utc",
                        "2026-07-30T01:00:00Z",
                        "--confirm-source-approved",
                    ]
                )

            self.assertEqual(result, 0)
            prepare_run_path = output / "prepare-run.json"
            prepare_run_bytes = prepare_run_path.read_bytes()
            prepare_run = json.loads(prepare_run_bytes)
            ledger = json.loads(ledger_path.read_bytes())
            self.assertEqual(
                ledger["preparation"]["sha256"],
                hashlib.sha256(prepare_run_bytes).hexdigest(),
            )
            self.assertEqual(
                prepare_run["preparer"]["scriptSha256"],
                hashlib.sha256(SCRIPT_PATH.read_bytes()).hexdigest(),
            )
            self.assertEqual(
                prepare_run["source"]["sourceCommit"],
                "d83e6edba6872a704f5d3b8b32f5cb540088dae6",
            )
            self.assertEqual(
                prepare_run["normalizedRecordsSha256"],
                hashlib.sha256(records_path.read_bytes()).hexdigest(),
            )
            self.assertEqual(
                prepare_run["reviewedSourceInputs"],
                ["harmony", "key", "meter", "beatTiming"],
            )
            self.assertEqual(
                prepare_run["emittedTrainingContent"],
                ["harmony", "key", "meter"],
            )
            self.assertEqual(
                prepare_run["counts"],
                {
                    "discoveredSourceItemCount": 1,
                    "eligibleSourceItemCount": 1,
                    "excludedSourceItemCount": 0,
                    "emittedRecordCount": 1,
                },
            )
            printed = json.loads(stdout.getvalue())
            self.assertEqual(
                printed["prepareRunPath"],
                str(prepare_run_path.resolve()),
            )

    def test_cli_rejects_a_preparer_script_changed_during_the_run(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            write_song(root, "001")
            simulated_script = root / "simulated-preparer.py"
            simulated_script.write_bytes(b"reviewed start bytes\n")
            start_sha256 = hashlib.sha256(
                simulated_script.read_bytes()
            ).hexdigest()
            original_prepare_corpus = MODULE.prepare_corpus

            def prepare_then_change_script(*args, **kwargs):
                corpus = original_prepare_corpus(*args, **kwargs)
                simulated_script.write_bytes(b"changed during execution\n")
                return corpus

            output = root / "private-output"
            arguments = [
                "--pop909",
                str(root),
                "--output-records",
                str(output / "records.jsonl"),
                "--output-ledger",
                str(output / "ledger.json"),
                "--source-version",
                "d83e6edba6872a704f5d3b8b32f5cb540088dae6",
                "--retrieved-at-utc",
                "2026-07-30T00:00:00Z",
                "--review-basis",
                "publicDomain",
                "--reviewed-at-utc",
                "2026-07-30T01:00:00Z",
                "--confirm-source-approved",
            ]
            with (
                mock.patch.object(
                    MODULE,
                    "_snapshot_preparer_script",
                    return_value=(simulated_script, start_sha256),
                ),
                mock.patch.object(
                    MODULE,
                    "prepare_corpus",
                    side_effect=prepare_then_change_script,
                ),
                contextlib.redirect_stderr(io.StringIO()),
                self.assertRaises(SystemExit),
            ):
                MODULE.main(arguments)

            self.assertFalse(output.exists())

    def test_atomic_write_preserves_existing_prepare_run_on_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "prepare-run.json"
            output.write_bytes(b"last-known-good\n")

            with (
                mock.patch.object(
                    MODULE.os,
                    "fsync",
                    side_effect=OSError("simulated sync failure"),
                ),
                self.assertRaises(OSError),
            ):
                MODULE.atomic_write(output, b"incomplete replacement\n")

            self.assertEqual(output.read_bytes(), b"last-known-good\n")
            self.assertEqual(
                list(output.parent.glob(".prepare-run.json.*.tmp")),
                [],
            )

    def test_bundle_install_is_all_or_nothing_and_never_overwrites(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            good = root / "good-v1"
            good_payloads = {
                good / "records.jsonl": b"old records\n",
                good / "ledger.json": b'{"old":"ledger"}\n',
                good / "prepare-run.json": b'{"old":"run"}\n',
            }
            MODULE.atomic_install_bundle(good_payloads)
            good_snapshot = {
                path.name: path.read_bytes() for path in good.iterdir()
            }

            with self.assertRaises(MODULE.PreparationError) as raised:
                MODULE.atomic_install_bundle(good_payloads)
            self.assertEqual(raised.exception.reason, "outputBundleExists")
            self.assertEqual(
                {path.name: path.read_bytes() for path in good.iterdir()},
                good_snapshot,
            )

            failed = root / "failed-v2"
            failed_payloads = {
                failed / "records.jsonl": b"new records\n",
                failed / "ledger.json": b'{"new":"ledger"}\n',
                failed / "prepare-run.json": b'{"new":"run"}\n',
            }
            original_writer = MODULE._write_bundle_file
            writes = 0

            def fail_on_third(path, payload):
                nonlocal writes
                writes += 1
                if writes == 3:
                    raise OSError("simulated third-file failure")
                original_writer(path, payload)

            with (
                mock.patch.object(
                    MODULE,
                    "_write_bundle_file",
                    side_effect=fail_on_third,
                ),
                self.assertRaises(OSError),
            ):
                MODULE.atomic_install_bundle(failed_payloads)

            self.assertEqual(writes, 3)
            self.assertFalse(failed.exists())
            self.assertEqual(
                list(root.glob(".failed-v2.stage-*")),
                [],
            )
            self.assertEqual(
                {path.name: path.read_bytes() for path in good.iterdir()},
                good_snapshot,
            )

    def test_song_becomes_key_relative_harmony_only_record(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            song = write_song(root, "001")

            record = MODULE.prepare_song(song, gap_policy="reject")

            self.assertEqual(record["recordId"], "pop909-001")
            self.assertEqual(record["ppq"], 480)
            self.assertEqual(record["ticksPerBar"], 1920)
            self.assertEqual(record["timeSignature"], "4/4")
            self.assertEqual(record["startTick"], 0)
            self.assertEqual(record["endTick"], 3840)
            self.assertFalse(record["synthetic"])
            self.assertNotIn("melody", record)
            self.assertNotIn("style", record)
            self.assertNotIn("title", record)
            self.assertNotIn("artist", record)
            self.assertNotIn("midi", record)
            self.assertNotIn("audio", record)
            self.assertNotIn("voicing", record)
            self.assertEqual(
                [
                    (
                        event["startTick"],
                        event["durationTick"],
                        event["rootOffsetFromKey"],
                        event["quality"],
                    )
                    for event in record["harmony"]
                ],
                [
                    (0, 960, 0, "major"),
                    (960, 960, 7, "dominant7"),
                    (1920, 960, 0, "minor7"),
                    (2880, 960, 7, "dominant7"),
                ],
            )
            self.assertEqual(
                record["tonalities"],
                [
                    {
                        "startTick": 0,
                        "endTick": 1920,
                        "keyRoot": 0,
                        "mode": "major",
                    },
                    {
                        "startTick": 1920,
                        "endTick": 3840,
                        "keyRoot": 9,
                        "mode": "naturalMinor",
                    },
                ],
            )

    def test_song_and_annotation_symlinks_are_rejected_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            song = write_song(root, "001")
            external = root / "external-chords.txt"
            external.write_text("0 8 C:maj\n", encoding="utf-8")
            chord_path = song / "chord_audio.txt"
            chord_path.unlink()
            try:
                chord_path.symlink_to(external)
            except OSError as exc:
                self.skipTest(f"symlinks are unavailable: {exc}")

            with self.assertRaises(MODULE.PreparationError) as raised:
                MODULE.prepare_corpus(root, gap_policy="reject")
            self.assertEqual(raised.exception.reason, "unsafeAnnotationFile")

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source_root = root / "source"
            external_song = write_song(source_root, "001")
            corpus_root = root / "corpus" / "POP909"
            corpus_root.mkdir(parents=True)
            try:
                (corpus_root / "001").symlink_to(
                    external_song,
                    target_is_directory=True,
                )
            except OSError as exc:
                self.skipTest(f"directory symlinks are unavailable: {exc}")

            with self.assertRaises(MODULE.PreparationError) as raised:
                MODULE.prepare_corpus(root / "corpus", gap_policy="reject")
            self.assertEqual(raised.exception.reason, "unsafeSongDirectory")

    def test_input_root_symlink_and_non_directory_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            real_root = root / "real"
            write_song(real_root, "001")
            linked_root = root / "linked"
            try:
                linked_root.symlink_to(real_root, target_is_directory=True)
            except OSError as exc:
                self.skipTest(f"directory symlinks are unavailable: {exc}")

            with self.assertRaises(MODULE.PreparationError) as raised:
                MODULE.prepare_corpus(linked_root, gap_policy="reject")
            self.assertEqual(raised.exception.reason, "unsafeCorpusRoot")

            non_directory = root / "not-a-directory"
            non_directory.write_text("not POP909", encoding="utf-8")
            with self.assertRaises(MODULE.PreparationError) as raised:
                MODULE.prepare_corpus(non_directory, gap_policy="reject")
            self.assertEqual(raised.exception.reason, "unsafeCorpusRoot")

    def test_non_regular_song_and_annotation_paths_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            song = write_song(root, "001")
            chord_path = song / "chord_audio.txt"
            chord_path.unlink()
            chord_path.mkdir()

            with self.assertRaises(MODULE.PreparationError) as raised:
                MODULE.prepare_corpus(root, gap_policy="reject")
            self.assertEqual(raised.exception.reason, "unsafeAnnotationFile")

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            corpus_root = root / "POP909"
            corpus_root.mkdir()
            (corpus_root / "001").write_text(
                "not a song directory",
                encoding="utf-8",
            )

            with self.assertRaises(MODULE.PreparationError) as raised:
                MODULE.prepare_corpus(root, gap_policy="reject")
            self.assertEqual(raised.exception.reason, "unsafeSongDirectory")

    def test_oversized_annotation_is_rejected_before_reading(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            song = write_song(root, "001")
            with (song / "chord_audio.txt").open("wb") as handle:
                handle.truncate(MODULE.MAXIMUM_ANNOTATION_BYTES + 1)

            with self.assertRaises(MODULE.PreparationError) as raised:
                MODULE.prepare_corpus(root, gap_policy="reject")
            self.assertEqual(raised.exception.reason, "annotationTooLarge")

    def test_hash_and_normalization_share_one_immutable_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            song = write_song(root, "001")
            original_hash_function = MODULE._source_material_sha256
            mutation_count = 0

            def hash_then_mutate(snapshots):
                nonlocal mutation_count
                digest = original_hash_function(snapshots)
                (song / "chord_audio.txt").write_text(
                    "0 2 C:maj\n"
                    "2 4 F:maj\n"
                    "4 6 A:min7\n"
                    "6 8 E:7\n",
                    encoding="utf-8",
                )
                mutation_count += 1
                return digest

            with mock.patch.object(
                MODULE,
                "_source_material_sha256",
                side_effect=hash_then_mutate,
            ):
                corpus = MODULE.prepare_corpus(root, gap_policy="reject")

            self.assertEqual(mutation_count, 1)
            self.assertEqual(
                corpus.records[0]["harmony"][1]["rootOffsetFromKey"],
                7,
            )
            fresh = MODULE.prepare_corpus(root, gap_policy="reject")
            self.assertEqual(
                fresh.records[0]["harmony"][1]["rootOffsetFromKey"],
                5,
            )
            self.assertNotEqual(
                corpus.source_material_sha256,
                fresh.source_material_sha256,
            )

    def test_snapshot_hash_preserves_the_reference_byte_order(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            write_song(root, "002")
            write_song(root, "001")
            songs = MODULE.resolve_song_directories(root)
            common_root = Path(
                MODULE.os.path.commonpath([str(song) for song in songs])
            )
            legacy_digest = hashlib.sha256()
            for song in songs:
                for name in MODULE.ANNOTATION_FILE_NAMES:
                    path = song / name
                    relative = (
                        path.relative_to(common_root)
                        .as_posix()
                        .encode("utf-8")
                    )
                    payload = path.read_bytes()
                    legacy_digest.update(len(relative).to_bytes(8, "big"))
                    legacy_digest.update(relative)
                    legacy_digest.update(len(payload).to_bytes(8, "big"))
                    legacy_digest.update(payload)

            corpus = MODULE.prepare_corpus(root, gap_policy="reject")

            self.assertEqual(
                corpus.source_material_sha256,
                legacy_digest.hexdigest(),
            )

    def test_adjacent_sub_frame_jitter_is_snapped(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            song = write_song(
                root,
                "002",
                chords=(
                    "0 2 C:maj\n"
                    "2.05 4 G:7\n"
                    "4 6 A:min7\n"
                    "6 8 E:7\n"
                ),
            )

            record = MODULE.prepare_song(song, gap_policy="reject")

            self.assertEqual(record["harmony"][0]["durationTick"], 960)
            self.assertEqual(record["harmony"][1]["startTick"], 960)

    def test_harte_slash_degree_and_altered_extension_are_factorized(self) -> None:
        chord = MODULE.parse_chord("Bb:maj7/3", key_root=0)
        self.assertEqual(chord["rootOffsetFromKey"], 10)
        self.assertEqual(chord["bassOffsetFromRoot"], 4)
        self.assertEqual(chord["inversion"], 1)

        altered = MODULE.parse_chord("C:7(b9,b13)", key_root=0)
        self.assertEqual(altered["quality"], "dominant7")
        self.assertEqual(altered["extensions"], ["b9", "b13"])

        minor = MODULE.parse_chord("C:min/3", key_root=0)
        self.assertEqual(minor["bassOffsetFromRoot"], 3)
        self.assertEqual(minor["inversion"], 1)

        diminished = MODULE.parse_chord("C:dim/5", key_root=0)
        self.assertEqual(diminished["bassOffsetFromRoot"], 6)
        self.assertEqual(diminished["inversion"], 2)

        non_member = MODULE.parse_chord("C:maj/2", key_root=0)
        self.assertEqual(non_member["bassOffsetFromRoot"], 2)
        self.assertEqual(non_member["inversion"], 4)

    def test_record_starts_at_first_downbeat_inside_annotation_overlap(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            song = write_song(
                root,
                "downbeat",
                chords="1 4 C:maj\n4 6 G:maj\n6 8 C:maj\n",
                keys="1 8 C:maj\n",
            )

            record = MODULE.prepare_song(song, gap_policy="reject")

            self.assertEqual(record["startTick"], 0)
            self.assertEqual(record["endTick"], 1920)
            self.assertEqual(record["harmony"][0]["startTick"], 0)
            self.assertEqual(record["harmony"][0]["originalLabel"], "G:maj")

    def test_long_song_splits_without_loss_overlap_or_leakage(self) -> None:
        ticks_per_bar = 1920
        original_end = 260 * ticks_per_bar + 960
        record = {
            "recordId": "pop909-long",
            "workId": "pop909-long",
            "sourceId": "pop909",
            "sourceItemId": "long",
            "ppq": 480,
            "ticksPerBar": ticks_per_bar,
            "timeSignature": "4/4",
            "startTick": 0,
            "endTick": original_end,
            "harmony": [
                {
                    "startTick": 0,
                    "durationTick": original_end,
                    "rootOffsetFromKey": 0,
                    "quality": "major",
                    "inversion": 0,
                    "bassOffsetFromRoot": 0,
                    "extensions": [],
                    "originalLabel": "C:maj",
                }
            ],
            "tonalities": [
                {
                    "startTick": 0,
                    "endTick": original_end,
                    "keyRoot": 0,
                    "mode": "major",
                }
            ],
            "synthetic": False,
        }

        parts = MODULE.split_record_at_bar_boundaries(record)

        self.assertEqual(
            [part["recordId"] for part in parts],
            [
                "pop909-long-part-001",
                "pop909-long-part-002",
                "pop909-long-part-003",
            ],
        )
        self.assertEqual({part["workId"] for part in parts}, {"pop909-long"})
        self.assertEqual({part["sourceItemId"] for part in parts}, {"long"})
        self.assertEqual(sum(part["endTick"] for part in parts), original_end)
        self.assertEqual(
            sum(
                event["durationTick"]
                for part in parts
                for event in part["harmony"]
            ),
            original_end,
        )
        for part in parts:
            self.assertEqual(part["startTick"], 0)
            self.assertLessEqual(part["endTick"], 128 * ticks_per_bar)
            self.assertEqual(part["tonalities"][0]["startTick"], 0)
            self.assertEqual(
                part["tonalities"][-1]["endTick"],
                part["endTick"],
            )
            previous_end = 0
            for event in part["harmony"]:
                self.assertGreaterEqual(event["startTick"], previous_end)
                previous_end = event["startTick"] + event["durationTick"]
                self.assertLessEqual(previous_end, part["endTick"])

    def test_under_limit_record_id_remains_stable(self) -> None:
        record = {
            "recordId": "pop909-short",
            "ticksPerBar": 1920,
            "endTick": 1920,
        }
        self.assertIs(
            MODULE.split_record_at_bar_boundaries(record)[0],
            record,
        )

    def test_one_frame_or_larger_gap_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            song = write_song(
                root,
                "003",
                chords=(
                    "0 2 C:maj\n"
                    "2.30 4 G:7\n"
                    "4 6 A:min7\n"
                    "6 8 E:7\n"
                ),
            )

            with self.assertRaisesRegex(
                MODULE.PreparationError,
                "gap after quantization",
            ) as raised:
                MODULE.prepare_song(song, gap_policy="reject")
            self.assertEqual(raised.exception.reason, "harmonyGapAfterQuantization")

    def test_uncovered_downbeat_is_not_silently_filled(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            song = write_song(
                root,
                "uncovered",
                chords="1 3 C:maj\n5 8 G:maj\n",
                keys="1 8 C:maj\n",
            )

            with self.assertRaises(MODULE.PreparationError) as raised:
                MODULE.prepare_song(song, gap_policy="allow-no-chord")
            self.assertEqual(
                raised.exception.reason,
                "harmonyGapAfterQuantization",
            )

    def test_invalid_beat_cycle_is_rejected_without_inventing_tempo(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            song = write_song(
                root,
                "004",
                beats="0 1\n1 2\n2 4\n3 1\n4 2\n",
            )

            with self.assertRaises(MODULE.PreparationError) as raised:
                MODULE.prepare_song(song, gap_policy="reject")
            self.assertEqual(raised.exception.reason, "invalidBeatGrid")

    def test_no_chord_requires_explicit_policy(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            song = write_song(
                root,
                "005",
                chords=(
                    "0 2 N\n"
                    "2 4 G:7\n"
                    "4 6 A:min7\n"
                    "6 8 E:7\n"
                ),
            )

            with self.assertRaises(MODULE.PreparationError) as raised:
                MODULE.prepare_song(song, gap_policy="reject")
            self.assertEqual(raised.exception.reason, "noChordRegion")
            record = MODULE.prepare_song(song, gap_policy="allow-no-chord")
            self.assertEqual(record["harmony"][0]["startTick"], 960)

    def test_v2_ledger_is_deterministic_and_strictly_shaped(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            write_song(root, "001")
            write_song(
                root,
                "broken",
                beats="0 1\n1 3\n2 4\n",
            )

            corpus = MODULE.prepare_corpus(root, gap_policy="reject")
            records_bytes = MODULE.canonical_jsonl(corpus.records)
            records_sha256 = hashlib.sha256(records_bytes).hexdigest()
            ledger = MODULE.build_ledger_v2(
                records_sha256=records_sha256,
                corpus=corpus,
                preparation_run_sha256="0" * 64,
                source_version="d83e6edba6872a704f5d3b8b32f5cb540088dae6",
                retrieved_at_utc="2026-07-30T00:00:00Z",
                reviewed_at_utc="2026-07-30T00:00:00Z",
                license_id="MIT",
            )

            self.assertEqual(ledger["schemaVersion"], 2)
            self.assertEqual(
                set(ledger),
                {
                    "schemaVersion",
                    "policyId",
                    "purpose",
                    "distributionScope",
                    "rawDataInGit",
                    "normalizedInputSha256",
                    "preparation",
                    "sources",
                },
            )
            self.assertEqual(ledger["policyId"], "harmony-only-private-v1")
            self.assertEqual(
                ledger["purpose"],
                "privateLocalHarmonyOnlyTraining",
            )
            self.assertEqual(ledger["distributionScope"], "privateLocalOnly")
            self.assertFalse(ledger["rawDataInGit"])
            self.assertEqual(ledger["normalizedInputSha256"], records_sha256)
            self.assertEqual(
                ledger["preparation"],
                {"schemaVersion": 1, "sha256": "0" * 64},
            )
            source = ledger["sources"][0]
            self.assertEqual(
                set(source),
                {
                    "sourceId",
                    "version",
                    "canonicalUrl",
                    "citation",
                    "retrievedAt",
                    "sourceMaterialSha256",
                    "normalizedRecordsSha256",
                    "review",
                    "attribution",
                    "removalProcedure",
                },
            )
            self.assertEqual(
                source["review"]["reviewedSourceInputs"],
                ["harmony", "key", "meter", "beatTiming"],
            )
            self.assertEqual(
                source["review"]["emittedTrainingContent"],
                ["harmony", "key", "meter"],
            )
            self.assertEqual(
                set(source["review"]),
                {
                    "status",
                    "basis",
                    "licenseId",
                    "reviewedSourceInputs",
                    "emittedTrainingContent",
                    "reviewedAt",
                },
            )
            self.assertEqual(source["normalizedRecordsSha256"], records_sha256)
            first = MODULE.canonical_json(ledger)
            second = MODULE.canonical_json(
                MODULE.build_ledger_v2(
                    records_sha256=records_sha256,
                    corpus=corpus,
                    preparation_run_sha256="0" * 64,
                    source_version="d83e6edba6872a704f5d3b8b32f5cb540088dae6",
                    retrieved_at_utc="2026-07-30T00:00:00Z",
                    reviewed_at_utc="2026-07-30T00:00:00Z",
                    license_id="MIT",
                )
            )
            self.assertEqual(first, second)

            record = json.loads(records_bytes)
            forbidden = {"melody", "style", "title", "artist", "midi", "audio", "voicing"}
            self.assertTrue(forbidden.isdisjoint(record))

    def test_output_compiles_with_strict_harmony_only_v2_profile(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            write_song(root, "001")
            corpus = MODULE.prepare_corpus(root, gap_policy="reject")
            records_bytes = MODULE.canonical_jsonl(corpus.records)
            records_sha256 = hashlib.sha256(records_bytes).hexdigest()
            prepare_run = MODULE.build_prepare_run(
                records_sha256=records_sha256,
                corpus=corpus,
                source_commit=(
                    "d83e6edba6872a704f5d3b8b32f5cb540088dae6"
                ),
                gap_policy="reject",
                preparer_sha256=hashlib.sha256(
                    SCRIPT_PATH.read_bytes()
                ).hexdigest(),
            )
            prepare_run_bytes = MODULE.canonical_json(prepare_run)
            ledger = MODULE.build_ledger_v2(
                records_sha256=records_sha256,
                corpus=corpus,
                preparation_run_sha256=hashlib.sha256(
                    prepare_run_bytes
                ).hexdigest(),
                source_version="d83e6edba6872a704f5d3b8b32f5cb540088dae6",
                retrieved_at_utc="2026-07-30T00:00:00Z",
                reviewed_at_utc="2026-07-30T00:00:00Z",
                license_id="MIT",
            )
            input_path = root / "records.jsonl"
            ledger_path = root / "ledger.json"
            prepare_run_path = root / "prepare-run.json"
            input_path.write_bytes(records_bytes)
            ledger_path.write_bytes(MODULE.canonical_json(ledger))
            prepare_run_path.write_bytes(prepare_run_bytes)

            manifest = compile_dataset(
                input_path,
                ledger_path,
                root / "processed",
                preparation_run_path=prepare_run_path,
                options=CompileOptions(
                    dataset_id="pop909-harmony-only",
                    dataset_version=(
                        "d83e6edba6872a704f5d3b8b32f5cb540088dae6"
                    ),
                    purpose=PRIVATE_HARMONY_TRAINING_PURPOSE,
                    content_profile="harmonyOnlyV1",
                    harmony_gap_policy=MODULE.COMPILER_GAP_POLICIES["reject"],
                ),
            )

            self.assertEqual(manifest["schemaVersion"], 2)
            self.assertEqual(manifest["contentProfile"], "harmonyOnlyV1")
            self.assertEqual(manifest["distributionScope"], "privateLocalOnly")
            self.assertEqual(
                manifest["ledger"]["reviewedSourceInputs"],
                ["harmony", "key", "meter", "beatTiming"],
            )
            self.assertEqual(
                manifest["ledger"]["emittedTrainingContent"],
                ["harmony", "key", "meter"],
            )
            self.assertEqual(
                manifest["ledger"]["preparation"],
                ledger["preparation"],
            )
            self.assertTrue((root / "processed" / "provenance.json").is_file())

            prepare_run_path.write_bytes(prepare_run_bytes + b" ")
            with self.assertRaisesRegex(
                DatasetCompileError,
                "preparation run checksum does not match",
            ):
                compile_dataset(
                    input_path,
                    ledger_path,
                    root / "tampered-processed",
                    preparation_run_path=prepare_run_path,
                    options=CompileOptions(
                        dataset_id="pop909-harmony-only",
                        dataset_version=(
                            "d83e6edba6872a704f5d3b8b32f5cb540088dae6"
                        ),
                        purpose=PRIVATE_HARMONY_TRAINING_PURPOSE,
                        content_profile="harmonyOnlyV1",
                        harmony_gap_policy=(
                            MODULE.COMPILER_GAP_POLICIES["reject"]
                        ),
                    ),
                )

    def test_source_hash_changes_only_for_consumed_annotations(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            song = write_song(root, "001")
            first = MODULE.prepare_corpus(root, gap_policy="reject")

            (song / "audio.wav").write_bytes(b"different-private-audio")
            (song / "001.mid").write_bytes(b"different-private-midi")
            second = MODULE.prepare_corpus(root, gap_policy="reject")
            self.assertEqual(
                first.source_material_sha256,
                second.source_material_sha256,
            )

            (song / "chord_audio.txt").write_text(
                "0 2 C:maj\n2 4 F:maj\n4 6 A:min7\n6 8 E:7\n",
                encoding="utf-8",
            )
            third = MODULE.prepare_corpus(root, gap_policy="reject")
            self.assertNotEqual(
                first.source_material_sha256,
                third.source_material_sha256,
            )


if __name__ == "__main__":
    unittest.main()
