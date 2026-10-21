"""Build/check the downloadable extension with only the Python standard library."""
from pathlib import Path
from io import BytesIO
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import sys

root = Path(__file__).resolve().parents[1]
files = ["manifest.json", "popup.html", "popup.js", "README.md"]
output = BytesIO()
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for name in files:
        info = ZipInfo("ai-thought-receipt-bridge/" + name, (2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (root / "chrome-extension" / name).read_bytes())
target = root / "public" / "ai-thought-receipt-bridge.zip"
if "--check" in sys.argv:
    if not target.exists() or target.read_bytes() != output.getvalue():
        raise SystemExit("Extension ZIP is out of date: run python3 scripts/package-extension.py")
    print("Extension ZIP matches its source files")
else:
    target.parent.mkdir(exist_ok=True)
    target.write_bytes(output.getvalue())
    print("Created public/ai-thought-receipt-bridge.zip")
