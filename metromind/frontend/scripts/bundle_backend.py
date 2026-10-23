"""Package the Python backend and a GTFS feed for the static (in-browser) build.

    python3 scripts/bundle_backend.py --dataset ../backend/data/sources/dmrc_gtfs.zip \
        --label "DMRC static GTFS (Aug 2023)" --source-url https://...

Writes public/static-backend/{app.zip,dataset.zip,manifest.json,wheels/,snapshots.json}, which Vite
copies into the build. The feed is copied byte-for-byte; its SHA-256 is recorded and re-checked in the
browser.

- wheels/: pure-Python packages Pyodide doesn't ship, served same-origin so the site never depends on
  PyPI being reachable (or unblocked by privacy browsers).
- snapshots.json: responses for a few read-only endpoints, produced by running the real backend on the
  bundled feed (needs the backend's requirements installed). The page shows these instantly while the
  in-browser engine boots; every later request is answered live.
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FRONTEND = HERE.parent
BACKEND_APP = FRONTEND.parent / "backend" / "app"
OUT = FRONTEND / "public" / "static-backend"
# Pure-Python wheels installed in the browser with micropip (deps resolved here, not at runtime).
WHEELS = ["networkx==3.5", "pydantic-settings==2.16.1", "python-dotenv==1.2.4", "python-multipart==0.0.32"]
# Read-only endpoints whose answers depend only on the bundled feed.
SNAPSHOT_PATHS = ["/api/meta", "/api/network/map", "/api/analytics/network", "/api/algorithms", "/api/datasets",
                  "/api/datasets/1", "/api/stations?q=&limit=12&offset=0"]
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
    wheel_dir = OUT / "wheels"
    subprocess.run([sys.executable, "-m", "pip", "download", "-q", "--no-deps", "--only-binary=:all:",
                    "-d", str(wheel_dir), *WHEELS], check=True)
    wheels = sorted(p.name for p in wheel_dir.glob("*.whl"))
    (OUT / "manifest.json").write_text(json.dumps({
        "label": args.label, "filename": args.dataset.name, "source_url": args.source_url,
        "sha256": sha, "attribution": ATTRIBUTION, "wheels": wheels,
    }, indent=2))
    write_snapshots(data, (OUT / "manifest.json").read_text())
    print(f"Bundled backend + {args.dataset.name} ({len(data) / 1e6:.1f} MB, sha256 {sha[:12]}…) into {OUT}")


def write_snapshots(dataset: bytes, manifest: str) -> None:
    os.environ.update({"METROMIND_DATABASE_URL": "sqlite:///:memory:", "METROMIND_AUTO_MIGRATE": "false",
                       "METROMIND_ENVIRONMENT": "static"})
    sys.path.insert(0, str(BACKEND_APP.parent))
    from app import inbrowser  # noqa: E402 - needs the env above

    inbrowser.boot(dataset, manifest)
    snaps = {}
    for path in SNAPSHOT_PATHS:
        r = inbrowser.handle("GET", path, "{}", None)
        if r["status"] != 200:
            raise SystemExit(f"Snapshot of {path} failed with HTTP {r['status']}: {r['body'][:200]}")
        snaps[path] = r["body"]
    (OUT / "snapshots.json").write_text(json.dumps(snaps))
    print(f"Wrote {len(snaps)} snapshots ({len(json.dumps(snaps)) / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
