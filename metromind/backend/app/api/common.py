from datetime import date, datetime, timezone

from fastapi import HTTPException

from ..graph.network import Station, TransitNetwork
from ..models import DatasetVersion
from ..state import ActiveNetwork, NoActiveDataset, store


def active() -> ActiveNetwork:
    try:
        return store.get()
    except NoActiveDataset as exc:
        raise HTTPException(503, detail={"code": "no_dataset", "message": str(exc) +
                                         " An administrator must import a GTFS dataset."}) from exc


def station_summary(net: TransitNetwork, st: Station) -> dict:
    return {"id": st.id, "name": st.name, "lat": st.lat, "lon": st.lon, "lines": sorted(st.lines),
            "interchange": len(st.lines) > 1, "routable": st.id in net.routable}


def aware(dt: datetime | None) -> datetime | None:
    """SQLite drops tzinfo; stored values are UTC, so re-attach it before serialising."""
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


def dataset_out(ds: DatasetVersion) -> dict:
    out = {c: getattr(ds, c) for c in ("id", "label", "source_kind", "source_url", "source_filename", "attribution",
                                        "sha256", "status", "is_active", "imported_at", "activated_at",
                                        "feed_version", "service_start", "service_end", "timezone")}
    out["imported_at"], out["activated_at"] = aware(ds.imported_at), aware(ds.activated_at)
    return out | {"stats": ds.stats or {}}


def freshness(ds: DatasetVersion, today: date) -> dict:
    if ds.service_end is None:
        return {"status": "unknown", "message": "The feed declares no service calendar."}
    if today > ds.service_end:
        return {"status": "expired", "message": f"The feed's service calendar ended on {ds.service_end.isoformat()}; "
                "timetable-aware routing only works for dates inside its validity window. Network structure and "
                "scheduled stop-to-stop times are still used for static routing."}
    if ds.service_start and today < ds.service_start:
        return {"status": "future", "message": f"The feed's service starts on {ds.service_start.isoformat()}."}
    days = (ds.service_end - today).days
    return {"status": "current" if days > 14 else "expiring",
            "message": f"Service calendar valid until {ds.service_end.isoformat()} ({days} days)."}
