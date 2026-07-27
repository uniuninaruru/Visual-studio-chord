import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).parents[1] / "train-harmony-corpus.py"
SPEC = importlib.util.spec_from_file_location("train_harmony_corpus", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class HarmonyCorpusTrainingTests(unittest.TestCase):
    def test_pop909_labels_become_key_relative_engine_tokens(self) -> None:
        self.assertEqual(MODULE.chord_token("G:7", "C:maj"), "7:dominant7")
        self.assertEqual(MODULE.chord_token("Bb:maj7/3", "C:min"), "10:major7")
        self.assertEqual(MODULE.chord_token("F#:hdim7", "E:min"), "2:halfDiminished7")

    def test_repeated_annotations_collapse_and_modulations_split(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            song = Path(temporary_directory)
            (song / "key_audio.txt").write_text(
                "0\t4\tC:maj\n4\t8\tD:maj\n",
                encoding="utf-8",
            )
            (song / "chord_audio.txt").write_text(
                "0\t1\tC:maj\n"
                "1\t2\tC:maj\n"
                "2\t3\tG:7\n"
                "3\t4\tC:maj\n"
                "4\t5\tD:maj\n"
                "5\t6\tA:7\n"
                "6\t8\tD:maj\n",
                encoding="utf-8",
            )

            self.assertEqual(
                MODULE.sequences_from_pop909_song(song),
                [
                    ["0:major", "7:dominant7", "0:major"],
                    ["0:major", "7:dominant7", "0:major"],
                ],
            )

    def test_atomic_model_output_contains_no_raw_song_data(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "model.json"
            payload = {
                "schemaVersion": 1,
                "modelId": MODULE.MODEL_ID,
                "source": {"rawSongDataBundled": False},
                "orders": MODULE.count_ngrams([["0:major", "7:dominant7"]], 2),
            }
            MODULE.atomic_write_json(output, payload)

            loaded = json.loads(output.read_text(encoding="utf-8"))
            self.assertFalse(loaded["source"]["rawSongDataBundled"])
            self.assertEqual(loaded["orders"]["2"]["0:major>7:dominant7"], 1)


if __name__ == "__main__":
    unittest.main()
