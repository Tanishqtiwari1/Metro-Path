"""Process-wide cache of the active dataset's network (rebuilt on activation)."""

import threading
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .graph.network import TransitNetwork
from .ingestion.importer import load_feed
from .models import DatasetVersion


class NoActiveDataset(RuntimeError):
    pass


@dataclass
class ActiveNetwork:
    dataset: DatasetVersion
    network: TransitNetwork
    cache: dict = field(default_factory=dict)


class NetworkStore:
    def __init__(self):
        self._lock = threading.RLock()
        self._active: ActiveNetwork | None = None
        self.last_error: str | None = None

    def get(self) -> ActiveNetwork:
        with self._lock:
            if self._active is None:
                raise NoActiveDataset("No valid dataset has been imported yet.")
            return self._active

    def peek(self) -> ActiveNetwork | None:
        return self._active

    def reload(self, session: Session) -> ActiveNetwork | None:
        settings = get_settings()
        with self._lock:
            ds = session.scalar(select(DatasetVersion).where(DatasetVersion.is_active.is_(True),
                                                             DatasetVersion.status == "valid"))
            if ds is None:
                self._active = None
                return None
            if self._active and self._active.dataset.id == ds.id:
                self._active.dataset = ds
                return self._active
            try:
                feed = load_feed(session, ds.id)
                net = TransitNetwork(feed, line_group_pattern=settings.line_group_pattern,
                                     infer_colors=settings.infer_line_colors)
            except Exception as exc:
                self.last_error = f"{exc.__class__.__name__}: {exc}"
                raise
            session.expunge(ds)
            self._active = ActiveNetwork(ds, net)
            self.last_error = None
            return self._active

    def clear(self) -> None:
        with self._lock:
            self._active = None


store = NetworkStore()
