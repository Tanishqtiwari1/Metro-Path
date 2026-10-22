"""Command-line administration.

    python -m app.cli import path/to/gtfs.zip --label "DMRC static GTFS" [--source-url URL] [--no-activate]
    python -m app.cli list
    python -m app.cli activate <dataset_id>
"""

import argparse
import json
import sys
from pathlib import Path

from sqlalchemy import select

from .config import get_settings
from .db import SessionLocal
from .ingestion.importer import ImportFailed, activate_dataset, import_archive
from .main import run_migrations
from .models import DatasetVersion


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="metromind")
    sub = parser.add_subparsers(dest="cmd", required=True)
    imp = sub.add_parser("import", help="Import a GTFS ZIP file")
    imp.add_argument("path", type=Path)
    imp.add_argument("--label", default=None)
    imp.add_argument("--source-url", default=None, help="Where the file was obtained (recorded for attribution)")
    imp.add_argument("--no-activate", action="store_true")
    sub.add_parser("list", help="List dataset versions")
    act = sub.add_parser("activate", help="Activate a dataset version")
    act.add_argument("dataset_id", type=int)
    args = parser.parse_args(argv)

    settings = get_settings()
    run_migrations()
    with SessionLocal() as session:
        if args.cmd == "import":
            if not args.path.is_file():
                print(f"No such file: {args.path}", file=sys.stderr)
                return 2
            try:
                ds = import_archive(session, args.path.read_bytes(), settings=settings, source_kind="file",
                                    filename=args.path.name, source_url=args.source_url,
                                    label=args.label or settings.dataset_source_label,
                                    attribution=settings.dataset_source_attribution, activate=not args.no_activate)
            except ImportFailed as exc:
                print(f"Import failed: {exc}", file=sys.stderr)
                return 1
            print(json.dumps({"id": ds.id, "status": ds.status, "active": ds.is_active, "stats": ds.stats},
                             indent=2, default=str))
            for w in ds.report.get("warnings", []):
                print(f"warning [{w['code']}]: {w['message']}")
        elif args.cmd == "list":
            for d in session.scalars(select(DatasetVersion).order_by(DatasetVersion.id)):
                flag = "ACTIVE" if d.is_active else "      "
                print(f"#{d.id:<4} {d.status:<7} {flag} {d.imported_at:%Y-%m-%d %H:%M} "
                      f"{d.label} ({d.source_filename or d.source_url or ''})")
        elif args.cmd == "activate":
            d = session.get(DatasetVersion, args.dataset_id)
            if d is None or d.status != "valid":
                print("Dataset not found or not valid.", file=sys.stderr)
                return 1
            activate_dataset(session, d)
            print(f"Dataset #{d.id} activated. Restart the API or call /api/admin/graph/rebuild.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
