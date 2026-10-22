"""Safe GTFS archive reading.

Archives are never extracted to disk. Members are read into memory after checking for
path traversal, nested directories, zip bombs and size limits.
"""

import hashlib
import io
import zipfile
from dataclasses import dataclass, field
from pathlib import PurePosixPath


class ArchiveError(ValueError):
    """The uploaded file is not a usable GTFS archive."""


KNOWN_FILES = {
    "agency.txt", "stops.txt", "routes.txt", "trips.txt", "stop_times.txt", "calendar.txt",
    "calendar_dates.txt", "transfers.txt", "shapes.txt", "fare_attributes.txt", "fare_rules.txt",
    "feed_info.txt", "frequencies.txt", "pathways.txt", "levels.txt",
}
REQUIRED_FILES = {"stops.txt", "routes.txt", "trips.txt", "stop_times.txt"}


@dataclass
class GtfsArchive:
    files: dict[str, bytes]
    sha256: str
    ignored: list[str] = field(default_factory=list)


def read_archive(data: bytes, *, max_uncompressed_bytes: int, max_ratio: float) -> GtfsArchive:
    if not data:
        raise ArchiveError("The file is empty.")
    if not zipfile.is_zipfile(io.BytesIO(data)):
        raise ArchiveError("The file is not a ZIP archive.")
    sha = hashlib.sha256(data).hexdigest()
    files: dict[str, bytes] = {}
    ignored: list[str] = []
    total = 0
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for info in zf.infolist():
            name = info.filename
            path = PurePosixPath(name.replace("\\", "/"))
            if path.is_absolute() or ".." in path.parts:
                raise ArchiveError(f"Unsafe path in archive: {name!r}")
            if info.is_dir():
                continue
            # macOS resource forks and hidden files are noise, not data.
            if any(p.startswith(".") or p == "__MACOSX" for p in path.parts):
                ignored.append(name)
                continue
            base = path.name.lower()
            if base not in KNOWN_FILES:
                ignored.append(name)
                continue
            if info.compress_size and info.file_size / max(info.compress_size, 1) > max_ratio:
                raise ArchiveError(f"{name} has a suspicious compression ratio; refusing to read it.")
            total += info.file_size
            if total > max_uncompressed_bytes:
                raise ArchiveError("Archive expands beyond the configured size limit.")
            if base in files:
                raise ArchiveError(f"Archive contains more than one {base}.")
            with zf.open(info) as fh:
                content = fh.read(info.file_size + 1)
            if len(content) != info.file_size:
                raise ArchiveError(f"{name} size does not match its header.")
            files[base] = content
    missing = REQUIRED_FILES - files.keys()
    if missing:
        raise ArchiveError(f"Missing required GTFS file(s): {', '.join(sorted(missing))}")
    return GtfsArchive(files=files, sha256=sha, ignored=ignored)
