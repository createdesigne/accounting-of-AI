import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "package_extension", ROOT / "scripts" / "package-extension.py"
)
assert SPEC and SPEC.loader
PACKAGE_EXTENSION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE_EXTENSION)


class PackageExtensionTests(unittest.TestCase):
    def test_text_line_endings_are_canonicalized(self):
        self.assertEqual(
            PACKAGE_EXTENSION.normalize_text_bytes(b"one\r\ntwo\rthree\n"),
            b"one\ntwo\nthree\n",
        )

    def test_lf_and_crlf_sources_build_the_same_archive(self):
        with TemporaryDirectory() as lf_dir, TemporaryDirectory() as crlf_dir:
            roots = [Path(lf_dir), Path(crlf_dir)]
            for root in roots:
                (root / "chrome-extension").mkdir()
            for name in PACKAGE_EXTENSION.FILES:
                (roots[0] / "chrome-extension" / name).write_bytes(b"first\nsecond\n")
                (roots[1] / "chrome-extension" / name).write_bytes(b"first\r\nsecond\r\n")

            self.assertEqual(
                PACKAGE_EXTENSION.build_archive(roots[0]),
                PACKAGE_EXTENSION.build_archive(roots[1]),
            )

    def test_crlf_checkout_matches_lf_archive_contents(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source_dir = root / "chrome-extension"
            source_dir.mkdir()
            target = root / "extension.zip"
            with ZipFile(target, "w", ZIP_DEFLATED) as archive:
                for name in PACKAGE_EXTENSION.FILES:
                    (source_dir / name).write_bytes(b"first\r\nsecond\r\n")
                    archive.writestr(PACKAGE_EXTENSION.ARCHIVE_ROOT + name, b"first\nsecond\n")

            PACKAGE_EXTENSION.check_archive(root, target)

    def test_unexpected_archive_files_are_rejected(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source_dir = root / "chrome-extension"
            source_dir.mkdir()
            target = root / "extension.zip"
            for name in PACKAGE_EXTENSION.FILES:
                (source_dir / name).write_text("source\n", encoding="utf-8")
            with ZipFile(target, "w", ZIP_DEFLATED) as archive:
                for name in PACKAGE_EXTENSION.FILES:
                    archive.writestr(PACKAGE_EXTENSION.ARCHIVE_ROOT + name, b"source\n")
                archive.writestr(PACKAGE_EXTENSION.ARCHIVE_ROOT + "unexpected.txt", b"extra")

            with self.assertRaises(SystemExit):
                PACKAGE_EXTENSION.check_archive(root, target)


if __name__ == "__main__":
    unittest.main()
