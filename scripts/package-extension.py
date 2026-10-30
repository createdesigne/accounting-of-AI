"""Build/check the downloadable extension with only the Python standard library."""
from io import BytesIO
from pathlib import Path
from zipfile import BadZipFile, ZipFile, ZipInfo, ZIP_DEFLATED
import sys

FILES = ["manifest.json", "popup.html", "popup.js", "README.md"]
ARCHIVE_ROOT = "ai-thought-receipt-bridge/"


def normalize_text_bytes(data: bytes) -> bytes:
    """Use one archive representation regardless of the checkout's line endings."""
    return data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def build_archive(root: Path) -> bytes:
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for name in FILES:
            info = ZipInfo(ARCHIVE_ROOT + name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            source = (root / "chrome-extension" / name).read_bytes()
            archive.writestr(info, normalize_text_bytes(source))
    return output.getvalue()


def check_archive(root: Path, target: Path) -> None:
    expected_names = [ARCHIVE_ROOT + name for name in FILES]
    try:
        with ZipFile(target) as archive:
            if archive.namelist() != expected_names:
                raise ValueError("unexpected file list")
            for name, archive_name in zip(FILES, expected_names):
                source = normalize_text_bytes((root / "chrome-extension" / name).read_bytes())
                if archive.read(archive_name) != source:
                    raise ValueError(f"content differs: {name}")
    except (BadZipFile, FileNotFoundError, OSError, ValueError) as error:
        raise SystemExit(
            "Extension ZIP is out of date: run python3 scripts/package-extension.py"
        ) from error


def main(args: list[str] | None = None) -> None:
    root = Path(__file__).resolve().parents[1]
    target = root / "public" / "ai-thought-receipt-bridge.zip"
    if "--check" in (args if args is not None else sys.argv[1:]):
        check_archive(root, target)
        print("Extension ZIP matches its source files")
        return

    archive = build_archive(root)
    target.parent.mkdir(exist_ok=True)
    target.write_bytes(archive)
    print("Created public/ai-thought-receipt-bridge.zip")


if __name__ == "__main__":
    main()
