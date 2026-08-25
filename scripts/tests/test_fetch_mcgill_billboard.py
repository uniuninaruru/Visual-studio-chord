from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT_PATH = Path(__file__).parents[1] / "fetch-mcgill-billboard.py"
SPEC = importlib.util.spec_from_file_location("fetch_mcgill_billboard", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def make_archive(
    entries: list[tuple[str, bytes, bytes | None]],
) -> bytes:
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        for name, data, member_type in entries:
            member = tarfile.TarInfo(name)
            if member_type is None:
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
            else:
                member.type = member_type
                if member_type == tarfile.SYMTYPE:
                    member.linkname = data.decode()
                elif member_type == tarfile.LNKTYPE:
                    member.linkname = data.decode()
                archive.addfile(member)
    return output.getvalue()


def snapshot(data: bytes) -> MODULE.ArchiveSnapshot:
    return MODULE.ArchiveSnapshot(data, hashlib.sha256(data).hexdigest())


def valid_entries(count: int = 2) -> list[tuple[str, bytes, bytes | None]]:
    return [
        (
            f"McGill-Billboard/{index:04d}/salami_chords.txt",
            b"# metre: 4/4\n0.0\t| C:maj |\n",
            None,
        )
        for index in range(1, count + 1)
    ]


class TargetSafetyTests(unittest.TestCase):
    def test_default_pins_and_help_does_not_leak_absolute_path(self) -> None:
        arguments = MODULE.build_argument_parser().parse_args([])
        self.assertEqual(arguments.target, MODULE.DEFAULT_TARGET)
        self.assertEqual(
            MODULE.ARCHIVE_URL,
            "https://www.dropbox.com/s/2lvny9ves8kns4o/billboard-2.0-salami_chords.tar.gz?dl=1",
        )
        self.assertEqual(
            MODULE.EXPECTED_ARCHIVE_SHA256,
            "a22e32bf24c8a18859ce18427c6501a7a72520185cddd6d882ceb3c61d02ec75",
        )
        self.assertEqual(MODULE.EXPECTED_MEMBER_COUNT, 890)
        self.assertNotIn(
            str(MODULE.PROJECT_ROOT), MODULE.build_argument_parser().format_help()
        )

    def test_target_root_outside_nonempty_file_and_symlink_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw = root / "datasets" / "raw"
            raw.mkdir(parents=True)
            with self.assertRaisesRegex(MODULE.AcquisitionError, "child"):
                MODULE.resolve_target(raw, project_raw_root=raw)
            with self.assertRaisesRegex(MODULE.AcquisitionError, "outside"):
                MODULE.resolve_target(root / "outside", project_raw_root=raw)
            nonempty = raw / "nonempty"
            nonempty.mkdir()
            (nonempty / "keep").write_text("keep", encoding="utf-8")
            with self.assertRaisesRegex(MODULE.AcquisitionError, "not empty"):
                MODULE.resolve_target(nonempty, project_raw_root=raw)
            regular = raw / "file"
            regular.write_text("file", encoding="utf-8")
            with self.assertRaisesRegex(MODULE.AcquisitionError, "not a directory"):
                MODULE.resolve_target(regular, project_raw_root=raw)
            symlink = raw / "link"
            symlink.symlink_to(root)
            with self.assertRaisesRegex(MODULE.AcquisitionError, "symbolic"):
                MODULE.resolve_target(symlink, project_raw_root=raw)


class ArchiveValidationTests(unittest.TestCase):
    def validate(self, data: bytes, **overrides: object) -> MODULE.ArchiveStats:
        expected = hashlib.sha256(data).hexdigest()
        with mock.patch.object(
            MODULE, "EXPECTED_MEMBER_COUNT", overrides.pop("count", 1)
        ):
            return MODULE.validate_archive(data, expected_sha256=expected)

    def test_hash_mismatch_and_non_utf8_are_rejected(self) -> None:
        data = make_archive(valid_entries(1))
        with mock.patch.object(MODULE, "EXPECTED_MEMBER_COUNT", 1):
            with self.assertRaisesRegex(MODULE.AcquisitionError, "SHA-256 mismatch"):
                MODULE.validate_archive(data, expected_sha256="0" * 64)
        bad = make_archive([("McGill-Billboard/0001/salami_chords.txt", b"\xff", None)])
        expected = hashlib.sha256(bad).hexdigest()
        with mock.patch.object(MODULE, "EXPECTED_MEMBER_COUNT", 1):
            with tempfile.TemporaryDirectory() as temporary:
                with self.assertRaisesRegex(MODULE.AcquisitionError, "UTF-8"):
                    MODULE.extract_validated_archive(
                        snapshot(bad),
                        Path(temporary) / "stage",
                        expected_sha256=expected,
                    )

    def test_archive_path_rules_and_duplicate_are_rejected(self) -> None:
        for name in (
            "/McGill-Billboard/0001/salami_chords.txt",
            "McGill-Billboard/../0001/salami_chords.txt",
            "McGill-Billboard\\0001\\salami_chords.txt",
            "McGill-Billboard/0001/other.txt",
        ):
            with self.subTest(name=name):
                data = make_archive([(name, b"text", None)])
                expected = hashlib.sha256(data).hexdigest()
                with mock.patch.object(MODULE, "EXPECTED_MEMBER_COUNT", 1):
                    with self.assertRaises(MODULE.AcquisitionError):
                        MODULE.validate_archive(data, expected_sha256=expected)
        duplicate = make_archive(valid_entries(1) * 2)
        expected = hashlib.sha256(duplicate).hexdigest()
        with mock.patch.object(MODULE, "EXPECTED_MEMBER_COUNT", 2):
            with self.assertRaisesRegex(MODULE.AcquisitionError, "duplicate"):
                MODULE.validate_archive(duplicate, expected_sha256=expected)

    def test_links_devices_directories_and_entry_limits_are_rejected(self) -> None:
        for member_type in (
            tarfile.SYMTYPE,
            tarfile.LNKTYPE,
            tarfile.CHRTYPE,
            tarfile.DIRTYPE,
        ):
            with self.subTest(member_type=member_type):
                data = make_archive(
                    [
                        (
                            "McGill-Billboard/0001/salami_chords.txt",
                            b"target",
                            member_type,
                        )
                    ]
                )
                expected = hashlib.sha256(data).hexdigest()
                with mock.patch.object(MODULE, "EXPECTED_MEMBER_COUNT", 1):
                    with self.assertRaises(MODULE.AcquisitionError):
                        MODULE.validate_archive(data, expected_sha256=expected)
        data = make_archive(valid_entries(1))
        with (
            mock.patch.object(MODULE, "EXPECTED_MEMBER_COUNT", 1),
            mock.patch.object(MODULE, "MAX_ARCHIVE_ENTRIES", 0),
        ):
            with self.assertRaisesRegex(MODULE.AcquisitionError, "too many entries"):
                MODULE.validate_archive(
                    data, expected_sha256=hashlib.sha256(data).hexdigest()
                )

    def test_member_and_total_extracted_limits_are_rejected(self) -> None:
        entries = [("McGill-Billboard/0001/salami_chords.txt", b"12345", None)]
        data = make_archive(entries)
        digest = hashlib.sha256(data).hexdigest()
        with (
            mock.patch.object(MODULE, "EXPECTED_MEMBER_COUNT", 1),
            mock.patch.object(MODULE, "MAX_MEMBER_BYTES", 4),
        ):
            with self.assertRaisesRegex(MODULE.AcquisitionError, "too large"):
                MODULE.validate_archive(data, expected_sha256=digest)
        entries = [
            (f"McGill-Billboard/{index:04d}/salami_chords.txt", b"123", None)
            for index in (1, 2)
        ]
        data = make_archive(entries)
        digest = hashlib.sha256(data).hexdigest()
        with (
            mock.patch.object(MODULE, "EXPECTED_MEMBER_COUNT", 2),
            mock.patch.object(MODULE, "MAX_EXTRACTED_BYTES", 5),
        ):
            with self.assertRaisesRegex(MODULE.AcquisitionError, "extracted-size"):
                MODULE.validate_archive(data, expected_sha256=digest)

    def test_extract_uses_injected_expected_sha(self) -> None:
        data = make_archive(valid_entries(1))
        digest = hashlib.sha256(data).hexdigest()
        with mock.patch.object(MODULE, "EXPECTED_MEMBER_COUNT", 1):
            with tempfile.TemporaryDirectory() as temporary:
                stats = MODULE.extract_validated_archive(
                    snapshot(data),
                    Path(temporary) / "stage",
                    expected_sha256=digest,
                )
        self.assertEqual(stats.member_count, 1)

    def test_forged_snapshot_digest_is_rejected(self) -> None:
        data = make_archive(valid_entries(1))
        forged = MODULE.ArchiveSnapshot(data, MODULE.EXPECTED_ARCHIVE_SHA256)
        with mock.patch.object(MODULE, "EXPECTED_MEMBER_COUNT", 1):
            with self.assertRaisesRegex(MODULE.AcquisitionError, "snapshot SHA-256"):
                MODULE.validate_archive(
                    forged,
                    expected_sha256=MODULE.EXPECTED_ARCHIVE_SHA256,
                )


class AcquisitionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = make_archive(valid_entries(2))
        self.digest = hashlib.sha256(self.data).hexdigest()

    def acquire(self, root: Path, **kwargs: object) -> MODULE.ArchiveStats:
        with mock.patch.object(MODULE, "EXPECTED_MEMBER_COUNT", 2):
            return MODULE.acquire_mcgill(
                root / "datasets" / "raw" / "McGill-Billboard-v2",
                expected_sha256=self.digest,
                project_raw_root=root / "datasets" / "raw",
                **kwargs,
            )

    def test_successful_install_receipt_and_outer_staging_cleanup(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with mock.patch.object(
                MODULE,
                "download_archive",
                return_value=snapshot(self.data),
            ):
                stats = self.acquire(root)
            target = root / "datasets" / "raw" / "McGill-Billboard-v2"
            self.assertEqual(stats.member_count, 2)
            self.assertEqual(
                len(list(target.glob("McGill-Billboard/*/salami_chords.txt"))), 2
            )
            receipt = target / MODULE.RECEIPT_NAME
            self.assertEqual(receipt.exists(), True)
            self.assertEqual(receipt.read_text(encoding="utf-8").count(self.digest), 1)
            receipt_payload = json.loads(receipt.read_text(encoding="utf-8"))
            self.assertTrue(receipt_payload["annotationsOnly"])
            self.assertFalse(receipt_payload["audioBundled"])
            self.assertFalse(receipt_payload["titlesOrArtistsPublished"])
            self.assertNotIn("rawSongDataBundled", receipt_payload)
            self.assertEqual(list(target.parent.glob(".*.fetch-*")), [])

    def test_cleanup_failure_during_failed_install_leaves_formal_target_absent(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with (
                mock.patch.object(
                    MODULE, "download_archive", return_value=snapshot(self.data)
                ),
                mock.patch.object(
                    MODULE,
                    "_write_receipt",
                    side_effect=MODULE.AcquisitionError("receipt failure"),
                ),
                mock.patch.object(
                    MODULE,
                    "_cleanup_staging",
                    side_effect=MODULE.AcquisitionError("cleanup failure"),
                ),
                mock.patch.object(MODULE, "EXPECTED_MEMBER_COUNT", 2),
            ):
                with self.assertRaisesRegex(MODULE.AcquisitionError, "cleanup failure"):
                    MODULE.acquire_mcgill(
                        root / "datasets" / "raw" / "McGill-Billboard-v2",
                        expected_sha256=self.digest,
                        project_raw_root=root / "datasets" / "raw",
                    )
            self.assertFalse(
                (root / "datasets" / "raw" / "McGill-Billboard-v2").exists()
            )

    def test_download_rejects_invalid_and_oversize_content_length(self) -> None:
        for content_length in ("not-a-number", str(MODULE.MAX_DOWNLOAD_BYTES + 1)):
            with (
                self.subTest(content_length=content_length),
                tempfile.TemporaryDirectory() as temporary,
            ):
                response = mock.MagicMock()
                response.headers = {"Content-Length": content_length}
                response.__enter__.return_value = response
                with mock.patch.object(
                    MODULE.urllib.request, "urlopen", return_value=response
                ):
                    with self.assertRaisesRegex(
                        MODULE.AcquisitionError, "Content-Length|size limit"
                    ):
                        MODULE.download_archive(
                            Path(temporary) / "archive",
                            expected_sha256=self.digest,
                        )

        with tempfile.TemporaryDirectory() as temporary:
            response = mock.MagicMock()
            response.headers = {}
            response.read.side_effect = [b"1234", b""]
            response.__enter__.return_value = response
            with (
                mock.patch.object(MODULE, "MAX_DOWNLOAD_BYTES", 3),
                mock.patch.object(
                    MODULE.urllib.request, "urlopen", return_value=response
                ),
            ):
                with self.assertRaisesRegex(MODULE.AcquisitionError, "size limit"):
                    MODULE.download_archive(
                        Path(temporary) / "archive",
                        expected_sha256=self.digest,
                    )

    def test_failures_leave_no_formal_target_or_staging(self) -> None:
        for failure in (
            "download_archive",
            "extract_validated_archive",
            "_write_receipt",
            "_install_validated",
        ):
            with (
                self.subTest(failure=failure),
                tempfile.TemporaryDirectory() as temporary,
            ):
                root = Path(temporary)
                patches = {
                    "download_archive": mock.patch.object(
                        MODULE,
                        "download_archive",
                        side_effect=MODULE.AcquisitionError("download"),
                    ),
                    "extract_validated_archive": mock.patch.object(
                        MODULE,
                        "extract_validated_archive",
                        side_effect=MODULE.AcquisitionError("extract"),
                    ),
                    "_write_receipt": mock.patch.object(
                        MODULE,
                        "_write_receipt",
                        side_effect=MODULE.AcquisitionError("receipt"),
                    ),
                    "_install_validated": mock.patch.object(
                        MODULE,
                        "_install_validated",
                        side_effect=MODULE.AcquisitionError("install"),
                    ),
                }
                with mock.patch.object(
                    MODULE, "download_archive", return_value=snapshot(self.data)
                ):
                    with patches[failure]:
                        with mock.patch.object(MODULE, "EXPECTED_MEMBER_COUNT", 2):
                            with self.assertRaises(MODULE.AcquisitionError):
                                MODULE.acquire_mcgill(
                                    root / "datasets" / "raw" / "McGill-Billboard-v2",
                                    expected_sha256=self.digest,
                                    project_raw_root=root / "datasets" / "raw",
                                )
                raw = root / "datasets" / "raw"
                self.assertFalse((raw / "McGill-Billboard-v2").exists())
                self.assertEqual(list(raw.glob(".*.fetch-*")), [])

    def test_empty_target_race_to_symlink_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw = root / "datasets" / "raw"
            target = raw / "McGill-Billboard-v2"
            original = MODULE._install_validated

            def race(staging: Path, destination: Path) -> None:
                destination.symlink_to(root)
                original(staging, destination)

            with mock.patch.object(
                MODULE, "download_archive", return_value=snapshot(self.data)
            ):
                with mock.patch.object(MODULE, "_install_validated", side_effect=race):
                    with mock.patch.object(MODULE, "EXPECTED_MEMBER_COUNT", 2):
                        with self.assertRaisesRegex(
                            MODULE.AcquisitionError, "symbolic"
                        ):
                            MODULE.acquire_mcgill(
                                target,
                                expected_sha256=self.digest,
                                project_raw_root=raw,
                            )
            self.assertTrue(target.is_symlink())
            self.assertEqual(list(raw.glob(".*.fetch-*")), [])

    def test_existing_nonempty_target_is_last_known_good(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw = root / "datasets" / "raw"
            target = raw / "McGill-Billboard-v2"
            target.mkdir(parents=True)
            keep = target / "keep.txt"
            keep.write_text("last known good", encoding="utf-8")
            with mock.patch.object(MODULE, "download_archive") as download:
                with self.assertRaisesRegex(MODULE.AcquisitionError, "not empty"):
                    MODULE.acquire_mcgill(
                        target,
                        expected_sha256=self.digest,
                        project_raw_root=raw,
                    )
            download.assert_not_called()
            self.assertEqual(keep.read_text(encoding="utf-8"), "last known good")

    def test_path_replacement_after_download_cannot_change_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original_validate = MODULE.validate_archive

            def mutate_path(archive: object, **kwargs: object) -> MODULE.ArchiveStats:
                if isinstance(archive, MODULE.ArchiveSnapshot):
                    for path in root.glob("datasets/raw/.*.fetch-*/.source.tar.gz"):
                        path.write_bytes(b"not-the-snapshot")
                return original_validate(archive, **kwargs)

            with mock.patch.object(
                MODULE, "download_archive", return_value=snapshot(self.data)
            ):
                with mock.patch.object(
                    MODULE, "validate_archive", side_effect=mutate_path
                ):
                    with mock.patch.object(MODULE, "EXPECTED_MEMBER_COUNT", 2):
                        stats = MODULE.acquire_mcgill(
                            root / "datasets" / "raw" / "McGill-Billboard-v2",
                            expected_sha256=self.digest,
                            project_raw_root=root / "datasets" / "raw",
                        )
            self.assertEqual(stats.member_count, 2)

    def test_no_shell_or_auth_headers(self) -> None:
        response = mock.MagicMock()
        response.headers = {"Content-Length": "3"}
        response.read.side_effect = [b"abc", b""]
        response.__enter__.return_value = response
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "archive"
            with mock.patch.object(
                MODULE.urllib.request, "urlopen", return_value=response
            ) as urlopen:
                with self.assertRaises(MODULE.AcquisitionError):
                    MODULE.download_archive(destination, expected_sha256="0" * 64)
        request = urlopen.call_args.args[0]
        self.assertNotIn("Authorization", request.headers)
        self.assertNotIn("Cookie", request.headers)
        self.assertNotIn("subprocess", MODULE.download_archive.__code__.co_names)


@unittest.skipUnless(
    os.environ.get("MTC_RUN_MCGILL_NETWORK_TEST") == "1",
    "set MTC_RUN_MCGILL_NETWORK_TEST=1 to run the canonical Dropbox integration test",
)
class NetworkTests(unittest.TestCase):
    def test_official_archive_can_be_fetched(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "archive.tar.gz"
            stats = MODULE.download_archive(path)
            self.assertEqual(stats.sha256, MODULE.EXPECTED_ARCHIVE_SHA256)
            validated = MODULE.validate_archive(stats)
            self.assertEqual(validated.member_count, 890)
            self.assertEqual(validated.extracted_bytes, 1_589_999)


if __name__ == "__main__":
    unittest.main()
