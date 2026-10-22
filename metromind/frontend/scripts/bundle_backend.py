"""Package the Python backend and a GTFS feed for the static (in-browser) build.

    python3 scripts/bundle_backend.py --dataset ../backend/data/sources/dmrc_gtfs.zip \
        --label "DMRC static GTFS (Aug 2023)" --source-url https://...

Writes public/static-backend/{app.zip,dataset.zip,manifest.json}, which Vite copies into the
build. The feed is copied byte-for-byte; its SHA-256 is recorded and re-checked in the browser.
"""

import argparse
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FRONTEND = HERE.parent
BACKEND_APP = FRONTEND.parent / "backend" / "app"
OUT = FRONTEND / "public" / "static-backend"
ATTRIBUTION = ("Department of Transport, GNCTD / IIIT-Delhi - Delhi Open Transit Data, https://otd.delhi.gov.in/ "
               "(reproduced unmodified with the source acknowledged; not endorsed by DMRC or the Department).")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True, type=Path, help="GTFS ZIP to bundle")
    ap.add_argument("--label", default="DMRC static GTFS")
    ap.add_argument("--source-url", default=None)
    ap.add_argument("--sha256", default=None, help="Expected checksum; the build fails if it differs")
    args = ap.parse_args()

    data = args.dataset.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    if args.sha256 and args.sha256.lower() != sha:
        raise SystemExit(f"Dataset checksum mismatch: expected {args.sha256}, got {sha}")

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    with zipfile.ZipFile(OUT / "app.zip", "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(BACKEND_APP.rglob("*.py")):
            if "__pycache__" in f.parts:
                continue
            zf.write(f, Path("app") / f.relative_to(BACKEND_APP))
    shutil.copyfile(args.dataset, OUT / "dataset.zip")
    (OUT / "manifest.json").write_text(json.dumps({
        "label": args.label, "filename": args.dataset.name, "source_url": args.source_url,
        "sha256": sha, "attribution": ATTRIBUTION,
    }, indent=2))
    print(f"Bundled backend + {args.dataset.name} ({len(data) / 1e6:.1f} MB, sha256 {sha[:12]}…) into {OUT}")


if __name__ == "__main__":
    main()
