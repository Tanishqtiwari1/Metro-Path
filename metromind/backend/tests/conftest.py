import os
import tempfile
from pathlib import Path

# Configure the app for tests *before* any app module is imported.
_TMP = Path(tempfile.mkdtemp(prefix="metromind-test-"))
os.environ["METROMIND_DATABASE_URL"] = f"sqlite:///{_TMP / 'test.db'}"
os.environ["METROMIND_ADMIN_TOKEN"] = "test-admin-token"
os.environ["METROMIND_ENVIRONMENT"] = "test"
os.environ["METROMIND_RATE_LIMIT_PER_MINUTE"] = "0"
os.environ["METROMIND_DATASET_SOURCE_URL"] = ""

import pytest  # noqa: E402

from app.graph.network import TransitNetwork  # noqa: E402
from app.ingestion.archive import read_archive  # noqa: E402
from app.ingestion.parser import parse_feed  # noqa: E402

from .gtfs_factory import standard_zip  # noqa: E402

PATTERN = r"^\s*([^_]+)_"


def network_from_zip(data: bytes) -> TransitNetwork:
    feed, _ = parse_feed(read_archive(data, max_uncompressed_bytes=50 << 20, max_ratio=500))
    return TransitNetwork(feed, line_group_pattern=PATTERN, infer_colors=True)


@pytest.fixture(scope="session")
def net() -> TransitNetwork:
    return network_from_zip(standard_zip())
