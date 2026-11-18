"""Build/check the downloadable extension with only the Python standard library."""
from io import BytesIO
import json
from pathlib import Path
import re
import subprocess
from tempfile import TemporaryDirectory
from zipfile import BadZipFile, ZipFile, ZipInfo, ZIP_DEFLATED
import sys

FILES = [
    "manifest.json",
    "popup.html",
    "popup.js",
    "activityTracker.js",
    "background.js",
    "activity.js",
    "timeRecordProtocol.js",
    "timeRecordBridge.js",
    "README.md",
]
ARCHIVE_ROOT = "ai-thought-receipt-bridge/"
IMPORT_SCRIPTS_PATTERN = re.compile(r"importScripts\(([^)]*)\)")
QUOTED_SCRIPT_PATTERN = re.compile(r'["\']([^"\']+\.js)["\']')


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


def validate_extracted_extension(extension_root: Path) -> None:
    """Validate the same folder shape that Chrome receives via Load unpacked."""
    extension_root = extension_root.resolve()
    manifest_path = extension_root / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("invalid or missing manifest.json") from error

    referenced = []
    service_worker = manifest.get("background", {}).get("service_worker")
    if not isinstance(service_worker, str) or not service_worker:
        raise ValueError("background.service_worker is missing")
    referenced.append(service_worker)
    popup = manifest.get("action", {}).get("default_popup")
    if isinstance(popup, str) and popup:
        referenced.append(popup)
    for entry in manifest.get("content_scripts", []):
        if isinstance(entry, dict):
            referenced.extend(name for name in entry.get("js", []) if isinstance(name, str))

    for relative in referenced:
        target = extension_root / relative
        if not target.is_file() or extension_root not in target.resolve().parents:
            raise ValueError(f"manifest dependency is missing: {relative}")

    worker_path = extension_root / service_worker
    worker_source = worker_path.read_text(encoding="utf-8")
    import_match = IMPORT_SCRIPTS_PATTERN.search(worker_source)
    if not import_match:
        raise ValueError("service worker importScripts declaration is missing")
    imports = QUOTED_SCRIPT_PATTERN.findall(import_match.group(1))
    if not imports:
        raise ValueError("service worker importScripts dependencies are missing")
    for relative in imports:
        target = worker_path.parent / relative
        if not target.is_file() or extension_root not in target.resolve().parents:
            raise ValueError(f"service worker dependency is missing: {relative}")

    for script in extension_root.glob("*.js"):
        result = subprocess.run(
            ["node", "--check", str(script)],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise ValueError(f"JavaScript syntax check failed: {script.name}")


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
            with TemporaryDirectory() as directory:
                archive.extractall(directory)
                validate_extracted_extension(Path(directory) / ARCHIVE_ROOT.rstrip("/"))
    except (BadZipFile, FileNotFoundError, OSError, ValueError) as error:
        raise SystemExit(
            "Extension ZIP is out of date: run python3 scripts/package-extension.py"
        ) from error


def main(args: list[str] | None = None) -> None:
    root = Path(__file__).resolve().parents[1]
    target = root / "public" / "ai-thought-receipt-bridge.zip"
    if "--check" in (args if args is not None else sys.argv[1:]):
        check_archive(root, target)
        print("Extension ZIP matches its source files and its extracted service worker is valid")
        return

    archive = build_archive(root)
    target.parent.mkdir(exist_ok=True)
    target.write_bytes(archive)
    print("Created public/ai-thought-receipt-bridge.zip")


if __name__ == "__main__":
    main()
