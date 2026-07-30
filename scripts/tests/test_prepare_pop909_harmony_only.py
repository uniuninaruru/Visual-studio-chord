from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


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
                source["review"]["allowedContent"],
                ["harmony", "key", "meter"],
            )
            self.assertEqual(
                set(source["review"]),
                {
                    "status",
                    "basis",
                    "licenseId",
                    "allowedContent",
                    "reviewedAt",
                },
            )
            self.assertEqual(source["normalizedRecordsSha256"], records_sha256)
            first = MODULE.canonical_json(ledger)
            second = MODULE.canonical_json(
                MODULE.build_ledger_v2(
                    records_sha256=records_sha256,
                    corpus=corpus,
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
            ledger = MODULE.build_ledger_v2(
                records_sha256=records_sha256,
                corpus=corpus,
                source_version="d83e6edba6872a704f5d3b8b32f5cb540088dae6",
                retrieved_at_utc="2026-07-30T00:00:00Z",
                reviewed_at_utc="2026-07-30T00:00:00Z",
                license_id="MIT",
            )
            input_path = root / "records.jsonl"
            ledger_path = root / "ledger.json"
            input_path.write_bytes(records_bytes)
            ledger_path.write_bytes(MODULE.canonical_json(ledger))

            manifest = compile_dataset(
                input_path,
                ledger_path,
                root / "processed",
                options=CompileOptions(
                    dataset_id="pop909-harmony-only",
                    dataset_version="v1",
                    purpose=PRIVATE_HARMONY_TRAINING_PURPOSE,
                    content_profile="harmonyOnlyV1",
                    harmony_gap_policy=MODULE.COMPILER_GAP_POLICIES["reject"],
                ),
            )

            self.assertEqual(manifest["schemaVersion"], 2)
            self.assertEqual(manifest["contentProfile"], "harmonyOnlyV1")
            self.assertEqual(manifest["distributionScope"], "privateLocalOnly")
            self.assertTrue((root / "processed" / "provenance.json").is_file())

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
