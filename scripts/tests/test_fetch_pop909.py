from __future__ import annotations

import contextlib
import importlib.util
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "fetch-pop909.py"
SPEC = importlib.util.spec_from_file_location("fetch_pop909", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def write_sparse_checkout(root: Path, song_count: int = 2) -> None:
    (root / ".git").mkdir()
    (root / "LICENSE").write_text("upstream license\n", encoding="utf-8")
    for song_number in range(1, song_count + 1):
        song = root / "POP909" / f"{song_number:03d}"
        song.mkdir(parents=True)
        for filename in MODULE.ANNOTATION_FILENAMES:
            (song / filename).write_text("annotation\n", encoding="utf-8")


def completed(arguments: list[str], stdout: str = "") -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(arguments, 0, stdout=stdout, stderr="")


class TargetSafetyTests(unittest.TestCase):
    def test_default_target_and_commit_are_pinned(self) -> None:
        arguments = MODULE.build_argument_parser().parse_args([])

        self.assertEqual(arguments.target, MODULE.DEFAULT_TARGET)
        self.assertEqual(arguments.commit, MODULE.DEFAULT_COMMIT)
        self.assertFalse(arguments.allow_outside_project_raw)
        self.assertEqual(
            MODULE.DEFAULT_COMMIT,
            "d83e6edba6872a704f5d3b8b32f5cb540088dae6",
        )

    def test_help_does_not_expose_a_developer_absolute_path(self) -> None:
        help_text = MODULE.build_argument_parser().format_help()

        self.assertNotIn(str(MODULE.PROJECT_ROOT), help_text)
        self.assertIn("<project>/datasets/raw/POP909-Dataset", help_text)

    def test_target_must_remain_beneath_project_raw_without_override(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            raw_root = root / "project" / "datasets" / "raw"
            inside = raw_root / "POP909-Dataset"
            outside = root / "elsewhere" / "POP909-Dataset"

            self.assertEqual(
                MODULE.resolve_target(inside, project_raw_root=raw_root),
                inside.resolve(),
            )
            with self.assertRaisesRegex(MODULE.AcquisitionError, "outside"):
                MODULE.resolve_target(outside, project_raw_root=raw_root)
            self.assertEqual(
                MODULE.resolve_target(
                    outside,
                    project_raw_root=raw_root,
                    allow_outside_project_raw=True,
                ),
                outside.resolve(),
            )

    def test_raw_root_itself_and_nonempty_or_ambiguous_targets_are_refused(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            raw_root = Path(temporary_directory) / "datasets" / "raw"
            raw_root.mkdir(parents=True)
            with self.assertRaisesRegex(MODULE.AcquisitionError, "child"):
                MODULE.resolve_target(raw_root, project_raw_root=raw_root)

            nonempty = raw_root / "nonempty"
            nonempty.mkdir()
            (nonempty / "keep.txt").write_text("do not overwrite\n", encoding="utf-8")
            with self.assertRaisesRegex(MODULE.AcquisitionError, "not empty"):
                MODULE.resolve_target(nonempty, project_raw_root=raw_root)

            regular_file = raw_root / "file"
            regular_file.write_text("not a directory\n", encoding="utf-8")
            with self.assertRaisesRegex(MODULE.AcquisitionError, "not a directory"):
                MODULE.resolve_target(regular_file, project_raw_root=raw_root)

    def test_commit_must_be_a_full_object_id(self) -> None:
        self.assertEqual(MODULE.normalize_commit("A" * 40), "a" * 40)
        for invalid in ("main", "d83e6ed", "g" * 40, "0" * 39, "0" * 41):
            with self.subTest(invalid=invalid):
                with self.assertRaises(MODULE.AcquisitionError):
                    MODULE.normalize_commit(invalid)


class GitContractTests(unittest.TestCase):
    def test_run_git_uses_an_argument_array_no_shell_and_no_credentials(self) -> None:
        inherited = {
            "GIT_ASKPASS": "/secret/askpass",
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "http.extraHeader",
            "GIT_CONFIG_VALUE_0": "Authorization: secret",
            "GITHUB_TOKEN": "secret-token",
        }
        with (
            mock.patch.dict(MODULE.os.environ, inherited, clear=False),
            mock.patch.object(MODULE.subprocess, "run") as run,
        ):
            run.return_value = completed(["git", "--version"], "git version test\n")

            result = MODULE.run_git(["--version"])

        self.assertEqual(result.stdout, "git version test\n")
        positional, keyword = run.call_args
        self.assertEqual(positional, (["git", "--version"],))
        self.assertTrue(keyword["check"])
        self.assertTrue(keyword["capture_output"])
        self.assertTrue(keyword["text"])
        self.assertFalse(keyword["shell"])
        environment = keyword["env"]
        for key in inherited:
            self.assertNotIn(key, environment)
        self.assertEqual(environment["GIT_TERMINAL_PROMPT"], "0")
        self.assertEqual(environment["GCM_INTERACTIVE"], "Never")
        self.assertEqual(environment["GIT_CONFIG_GLOBAL"], os.devnull)
        self.assertEqual(environment["GIT_CONFIG_NOSYSTEM"], "1")

    def test_acquisition_uses_partial_clone_noncone_sparse_checkout_and_exact_commit(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            raw_root = root / "project" / "datasets" / "raw"
            target = raw_root / "POP909-Dataset"
            commands: list[list[str]] = []
            staging_path: Path | None = None

            def fake_git(arguments: list[str]) -> subprocess.CompletedProcess[str]:
                nonlocal staging_path
                command = list(arguments)
                commands.append(command)
                if "clone" in command:
                    staging_path = Path(command[-1])
                if command[-3:] == ["remote", "get-url", "origin"]:
                    return completed(command, MODULE.CANONICAL_REPOSITORY + "\n")
                if command[-3:] == [
                    "config",
                    "--get",
                    "remote.origin.partialclonefilter",
                ]:
                    return completed(command, "blob:none\n")
                if command[-3:] == ["config", "--get", "remote.origin.promisor"]:
                    return completed(command, "true\n")
                if command[-3:] == [
                    "rev-parse",
                    "--verify",
                    "HEAD^{commit}",
                ]:
                    return completed(command, MODULE.DEFAULT_COMMIT + "\n")
                return completed(command)

            def fake_validation(
                checkout: Path,
                *,
                commit: str,
                expected_song_directories: int = MODULE.EXPECTED_SONG_DIRECTORIES,
            ) -> object:
                self.assertEqual(checkout, staging_path)
                self.assertEqual(commit, MODULE.DEFAULT_COMMIT)
                self.assertEqual(
                    expected_song_directories,
                    MODULE.EXPECTED_SONG_DIRECTORIES,
                )
                return MODULE.CheckoutStats(
                    target=checkout,
                    commit=commit,
                    song_directories=909,
                    annotation_files=2727,
                    forbidden_files=0,
                )

            with (
                mock.patch.object(MODULE, "run_git", side_effect=fake_git),
                mock.patch.object(
                    MODULE,
                    "validate_checkout",
                    side_effect=fake_validation,
                ),
            ):
                stats = MODULE.acquire_pop909(
                    target,
                    project_raw_root=raw_root,
                )

        self.assertEqual(stats.target, target.resolve())
        self.assertEqual(stats.commit, MODULE.DEFAULT_COMMIT)
        clone = commands[0]
        self.assertEqual(clone[:3], ["-c", "credential.helper=", "clone"])
        self.assertIn("--filter=blob:none", clone)
        self.assertIn("--no-checkout", clone)
        self.assertEqual(clone[-2], MODULE.CANONICAL_REPOSITORY)

        fetch = commands[1]
        self.assertEqual(fetch[-2:], ["origin", MODULE.DEFAULT_COMMIT])
        self.assertIn("--filter=blob:none", fetch)
        self.assertEqual(
            commands[2][-3:],
            ["config", "core.sparseCheckout", "true"],
        )
        self.assertEqual(
            commands[3][-3:],
            ["config", "core.sparseCheckoutCone", "false"],
        )
        self.assertEqual(
            commands[4][-len(MODULE.SPARSE_PATTERNS) :],
            list(MODULE.SPARSE_PATTERNS),
        )
        self.assertIn("--no-cone", commands[4])
        self.assertNotIn("init", (part for command in commands for part in command))
        self.assertEqual(
            commands[5][-3:],
            ["checkout", "--detach", MODULE.DEFAULT_COMMIT],
        )

    def test_head_mismatch_is_rejected(self) -> None:
        responses = iter(
            (
                MODULE.CANONICAL_REPOSITORY + "\n",
                "blob:none\n",
                "true\n",
                "0" * 40 + "\n",
            )
        )
        with mock.patch.object(
            MODULE,
            "run_git",
            side_effect=lambda arguments: completed(list(arguments), next(responses)),
        ):
            with self.assertRaisesRegex(MODULE.AcquisitionError, "HEAD mismatch"):
                MODULE.verify_git_checkout(Path("/checkout"), MODULE.DEFAULT_COMMIT)

    def test_failure_removes_owned_staging_without_touching_empty_target(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            raw_root = Path(temporary_directory) / "datasets" / "raw"
            target = raw_root / "POP909-Dataset"
            target.mkdir(parents=True)
            with mock.patch.object(
                MODULE,
                "run_git",
                side_effect=MODULE.AcquisitionError("network failed"),
            ):
                with self.assertRaisesRegex(MODULE.AcquisitionError, "network failed"):
                    MODULE.acquire_pop909(target, project_raw_root=raw_root)

            self.assertTrue(target.is_dir())
            self.assertEqual(list(target.iterdir()), [])
            self.assertEqual(
                list(raw_root.glob(".POP909-Dataset.fetch-*")),
                [],
            )

    def test_nonempty_target_is_rejected_before_git_runs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            raw_root = Path(temporary_directory) / "datasets" / "raw"
            target = raw_root / "POP909-Dataset"
            target.mkdir(parents=True)
            (target / "keep.txt").write_text("keep\n", encoding="utf-8")
            with mock.patch.object(MODULE, "run_git") as run:
                with self.assertRaisesRegex(MODULE.AcquisitionError, "not empty"):
                    MODULE.acquire_pop909(target, project_raw_root=raw_root)
            run.assert_not_called()
            self.assertEqual((target / "keep.txt").read_text(encoding="utf-8"), "keep\n")


class CheckoutValidationTests(unittest.TestCase):
    def test_exact_sparse_shape_and_counts_are_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory) / "checkout"
            target.mkdir()
            write_sparse_checkout(target, song_count=2)

            stats = MODULE.validate_checkout(
                target,
                commit=MODULE.DEFAULT_COMMIT,
                expected_song_directories=2,
            )

        self.assertEqual(stats.song_directories, 2)
        self.assertEqual(stats.annotation_files, 6)
        self.assertEqual(stats.forbidden_files, 0)

    def test_forbidden_midi_audio_and_zip_are_rejected(self) -> None:
        for filename in ("song.mid", "audio.WAV", "archive.zip"):
            with self.subTest(filename=filename):
                with tempfile.TemporaryDirectory() as temporary_directory:
                    target = Path(temporary_directory) / "checkout"
                    target.mkdir()
                    write_sparse_checkout(target, song_count=1)
                    (target / "POP909" / "001" / filename).write_bytes(b"forbidden")

                    with self.assertRaisesRegex(
                        MODULE.AcquisitionError,
                        "forbidden MIDI/audio/zip",
                    ):
                        MODULE.validate_checkout(
                            target,
                            commit=MODULE.DEFAULT_COMMIT,
                            expected_song_directories=1,
                        )

    def test_missing_or_unexpected_materialized_paths_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory) / "checkout"
            target.mkdir()
            write_sparse_checkout(target, song_count=1)
            (target / "POP909" / "001" / "key_audio.txt").unlink()
            (target / "README.md").write_text("unexpected\n", encoding="utf-8")

            with self.assertRaisesRegex(MODULE.AcquisitionError, "shape mismatch"):
                MODULE.validate_checkout(
                    target,
                    commit=MODULE.DEFAULT_COMMIT,
                    expected_song_directories=1,
                )

    def test_summary_prints_path_commit_and_all_counts(self) -> None:
        stats = MODULE.CheckoutStats(
            target=Path("/safe/POP909-Dataset"),
            commit=MODULE.DEFAULT_COMMIT,
            song_directories=909,
            annotation_files=2727,
            forbidden_files=0,
        )
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            MODULE.print_summary(stats)

        rendered = output.getvalue()
        self.assertIn("path: /safe/POP909-Dataset", rendered)
        self.assertIn(f"commit: {MODULE.DEFAULT_COMMIT}", rendered)
        self.assertIn("song_directories: 909", rendered)
        self.assertIn("annotation_files: 2727", rendered)
        self.assertIn("forbidden_midi_audio_zip_files: 0", rendered)


@unittest.skipUnless(
    os.environ.get("MTC_RUN_POP909_NETWORK_TEST") == "1",
    "set MTC_RUN_POP909_NETWORK_TEST=1 to run the canonical GitHub integration test",
)
class Pop909NetworkIntegrationTests(unittest.TestCase):
    def test_canonical_sparse_checkout(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory) / "POP909-Dataset"

            stats = MODULE.acquire_pop909(
                target,
                allow_outside_project_raw=True,
            )

            self.assertEqual(stats.commit, MODULE.DEFAULT_COMMIT)
            self.assertEqual(stats.song_directories, 909)
            self.assertEqual(stats.annotation_files, 2727)
            self.assertEqual(stats.forbidden_files, 0)


if __name__ == "__main__":
    unittest.main()
