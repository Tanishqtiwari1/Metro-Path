"""Import pipeline: archive -> validated feed -> network check -> transactional persistence.

A failed import is recorded (with its report) but never touches the active dataset.
"""

import logging
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy import insert, select, update
from sqlalchemy.orm import Session

from ..config import Settings
from ..graph.network import TransitNetwork
from ..models import (
    Agency,
    Calendar,
    CalendarDate,
    DatasetVersion,
    FareAttribute,
    ImportLog,
    Route,
    ShapePoint,
    Stop,
    StopTime,
    Transfer,
    Trip,
)
from .archive import ArchiveError, read_archive
from .parser import Feed, FeedError, parse_feed, tidy_display

log = logging.getLogger("metromind.import")
_CHUNK = 20_000


class ImportFailed(Exception):
    def __init__(self, message: str, dataset_id: int | None):
        super().__init__(message)
        self.dataset_id = dataset_id


def download_source(url: str, settings: Settings) -> bytes:
    """Fetch a GTFS ZIP from a configured URL with a size cap. Never follows to non-HTTP schemes."""
    if not url.lower().startswith(("https://", "http://")):
        raise ArchiveError("Only http(s) source URLs are supported.")
    import httpx  # imported lazily: not needed (or available) in the in-browser build

    limit = settings.max_upload_mb * 1024 * 1024
    with httpx.Client(timeout=settings.dataset_download_timeout_s, follow_redirects=True) as client:
        with client.stream("GET", url) as resp:
            if resp.status_code != 200:
                raise ArchiveError(f"Source returned HTTP {resp.status_code}.")
            chunks, size = [], 0
            for chunk in resp.iter_bytes():
                size += len(chunk)
                if size > limit:
                    raise ArchiveError("Source file exceeds the configured upload limit.")
                chunks.append(chunk)
    return b"".join(chunks)


def _records(df: pd.DataFrame, mapping: dict[str, str], dataset_id: int) -> list[dict]:
    out = df[list(mapping)].rename(columns=mapping)
    out = out.astype(object).where(pd.notna(out), None)
    recs = out.to_dict("records")
    for r in recs:
        r["dataset_id"] = dataset_id
    return recs


def _bulk(session: Session, model, records: list[dict]) -> None:
    for i in range(0, len(records), _CHUNK):
        session.execute(insert(model), records[i:i + _CHUNK])


def _persist(session: Session, ds: DatasetVersion, feed: Feed) -> None:
    did = ds.id
    if len(feed.agencies):
        _bulk(session, Agency, _records(feed.agencies, {"agency_id": "agency_id", "agency_name": "name",
                                                        "agency_url": "url", "agency_timezone": "timezone"}, did))
    stops = feed.stops.assign(parent_station=feed.stops["parent_station"].replace("", None),
                              code=feed.stops["code"].replace("", None))
    _bulk(session, Stop, _records(stops, {"stop_id": "stop_id", "stop_name": "name",
                                          "name_normalized": "name_normalized", "code": "code", "lat": "lat",
                                          "lon": "lon", "location_type": "location_type",
                                          "parent_station": "parent_station",
                                          "wheelchair_boarding": "wheelchair_boarding"}, did))
    routes = feed.routes.replace({"route_color": {"": None}, "route_text_color": {"": None}})
    _bulk(session, Route, _records(routes, {"route_id": "route_id", "agency_id": "agency_id",
                                            "route_short_name": "short_name", "route_long_name": "long_name",
                                            "route_type": "route_type", "route_color": "color",
                                            "route_text_color": "text_color"}, did))
    _bulk(session, Trip, _records(feed.trips, {"trip_id": "trip_id", "route_id": "route_id",
                                               "service_id": "service_id", "trip_headsign": "headsign",
                                               "direction_id": "direction_id", "shape_id": "shape_id"}, did))
    st = feed.stop_times
    st_recs = _records(st, {"trip_id": "trip_id", "stop_id": "stop_id", "stop_sequence": "stop_sequence",
                            "arrival_s": "arrival_s", "departure_s": "departure_s",
                            "shape_dist_traveled": "shape_dist_traveled"}, did)
    for r in st_recs:
        for k in ("arrival_s", "departure_s"):
            if r[k] is not None:
                r[k] = int(r[k])
    _bulk(session, StopTime, st_recs)
    if len(feed.calendars):
        _bulk(session, Calendar, _records(feed.calendars, {"service_id": "service_id", "days": "days",
                                                           "start_date": "start_date", "end_date": "end_date"}, did))
    if len(feed.calendar_dates):
        _bulk(session, CalendarDate, _records(feed.calendar_dates, {"service_id": "service_id", "date": "date",
                                                                    "exception_type": "exception_type"}, did))
    if len(feed.transfers):
        _bulk(session, Transfer, _records(feed.transfers, {"from_stop_id": "from_stop_id", "to_stop_id": "to_stop_id",
                                                           "transfer_type": "transfer_type",
                                                           "min_transfer_time": "min_transfer_time"}, did))
    if len(feed.shapes):
        _bulk(session, ShapePoint, _records(feed.shapes, {"shape_id": "shape_id", "sequence": "sequence",
                                                          "lat": "lat", "lon": "lon",
                                                          "dist_traveled": "dist_traveled"}, did))
    if len(feed.fares):
        _bulk(session, FareAttribute, _records(feed.fares, {"fare_id": "fare_id", "price": "price",
                                                            "currency_type": "currency_type"}, did))


def graph_report(net: TransitNetwork) -> dict:
    import networkx as nx

    from ..graph.nx_export import station_digraph
    g = station_digraph(net).to_undirected()
    comps = sorted(nx.connected_components(g), key=len, reverse=True) if g.number_of_nodes() else []
    return {"stations": len(net.stations), "routable_stations": len(net.routable), "edges": len(net.edges),
            "lines": len(net.lines), "connections": len(net.connections), "components": len(comps),
            "component_sizes": [len(c) for c in comps[:10]], "notes": net.notes,
            "schedule_supported": net.schedule_supported, "weekday_trip_hops": net.weekday_coverage}


def import_archive(session: Session, data: bytes, *, settings: Settings, source_kind: str, label: str,
                   source_url: str | None = None, filename: str | None = None, activate: bool = True,
                   attribution: str | None = None) -> DatasetVersion:
    ds = DatasetVersion(label=label, source_kind=source_kind, source_url=source_url, source_filename=filename,
                        attribution=attribution, sha256="", status="pending")
    session.add(ds)
    session.flush()
    logs: list[tuple[str, str]] = []

    def note(level: str, msg: str):
        logs.append((level, msg))
        getattr(log, "warning" if level == "warn" else level)(msg)

    def fail(message: str, report: dict | None = None):
        ds.status = "failed"
        ds.report = report or {"errors": [{"code": "import_failed", "message": message, "count": 1, "samples": []}],
                               "warnings": [], "info": {}}
        note("error", message)
        for lv, m in logs:
            session.add(ImportLog(dataset_id=ds.id, level=lv, message=m))
        session.commit()
        raise ImportFailed(message, ds.id)

    note("info", f"Import started ({source_kind}{': ' + filename if filename else ''}).")
    try:
        archive = read_archive(data, max_uncompressed_bytes=settings.max_uncompressed_mb * 1024 * 1024,
                               max_ratio=settings.max_compression_ratio)
    except ArchiveError as exc:
        fail(f"Archive rejected: {exc}")
    ds.sha256 = archive.sha256
    note("info", f"Archive OK: {len(archive.files)} GTFS file(s), sha256 {archive.sha256[:12]}…")
    dup = session.scalar(select(DatasetVersion).where(DatasetVersion.sha256 == archive.sha256,
                                                      DatasetVersion.status == "valid", DatasetVersion.id != ds.id))
    if dup:
        fail(f"This archive is identical to dataset version #{dup.id}; activate that version instead.")
    try:
        feed, report = parse_feed(archive)
    except FeedError as exc:
        fail(f"Feed rejected: {exc}")
    note("info", f"Parsed {report.info.get('stops')} stops, {report.info.get('routes')} routes, "
                 f"{report.info.get('trips')} trips, {report.info.get('stop_times')} stop times.")
    for w in report.warnings:
        note("warn", f"{w.code}: {w.message} ({w.count})")
    try:
        net = TransitNetwork(feed, line_group_pattern=settings.line_group_pattern,
                             infer_colors=settings.infer_line_colors)
    except Exception as exc:  # pragma: no cover - defensive: report rather than crash
        fail(f"Network construction failed: {exc.__class__.__name__}: {exc}", report.as_dict())
    greport = graph_report(net)
    report.info["graph"] = greport
    if not net.edges:
        report.error("no_edges", "No station-to-station connections could be derived.")
        fail("No station-to-station connections could be derived from the feed.", report.as_dict())
    if greport["components"] > 1:
        report.warn("disconnected_network", f"The network has {greport['components']} disconnected components; "
                    "some station pairs have no route.", count=greport["components"])
    note("info", f"Graph: {greport['stations']} stations, {greport['edges']} directed edges, "
                 f"{greport['components']} component(s).")

    try:
        _persist(session, ds, feed)
    except Exception as exc:
        session.rollback()
        # Record the failure in a fresh transaction; the half-written rows were rolled back.
        failed = DatasetVersion(label=label, source_kind=source_kind, source_url=source_url, source_filename=filename,
                                attribution=attribution, sha256=archive.sha256, status="failed",
                                report={"errors": [{"code": "persist_failed", "message": str(exc)[:500], "count": 1,
                                                    "samples": []}], "warnings": [], "info": {}})
        session.add(failed)
        session.commit()
        raise ImportFailed(f"Persisting the dataset failed: {exc.__class__.__name__}", failed.id) from exc

    ds.status = "valid"
    ds.report = report.as_dict()
    ds.feed_version = feed.feed_version
    ds.service_start, ds.service_end, ds.timezone = feed.service_start, feed.service_end, feed.timezone
    ds.stats = greport | {k: report.info.get(k) for k in ("stops", "routes", "trips", "stop_times", "shape_points")}
    note("info", "Import committed.")
    for lv, m in logs:
        session.add(ImportLog(dataset_id=ds.id, level=lv, message=m))
    if activate:
        activate_dataset(session, ds, commit=False)
    session.commit()
    return ds


def activate_dataset(session: Session, ds: DatasetVersion, *, commit: bool = True) -> None:
    if ds.status != "valid":
        raise ValueError("Only valid datasets can be activated.")
    session.execute(update(DatasetVersion).where(DatasetVersion.id != ds.id).values(is_active=False))
    ds.is_active = True
    ds.activated_at = datetime.now(timezone.utc)
    session.add(ImportLog(dataset_id=ds.id, level="info", message="Activated."))
    if commit:
        session.commit()


def load_feed(session: Session, dataset_id: int) -> Feed:
    """Rebuild a ``Feed`` from persisted rows (used at startup and on activation)."""
    bind = session.get_bind()

    def q(model, cols: dict[str, str], order: list[str] | None = None) -> pd.DataFrame:
        stmt = select(*[getattr(model, c) for c in cols]).where(model.dataset_id == dataset_id)
        if order:
            stmt = stmt.order_by(*[getattr(model, c) for c in order])
        df = pd.read_sql(stmt, bind)
        return df.rename(columns=cols)

    stops = q(Stop, {"stop_id": "stop_id", "name": "stop_name", "name_normalized": "name_normalized", "lat": "lat",
                     "lon": "lon", "location_type": "location_type", "parent_station": "parent_station",
                     "code": "code", "wheelchair_boarding": "wheelchair_boarding"})
    stops["parent_station"] = stops["parent_station"].fillna("").astype(str)
    stops["display_name"] = stops["stop_name"].map(tidy_display)
    routes = q(Route, {"route_id": "route_id", "agency_id": "agency_id", "short_name": "route_short_name",
                       "long_name": "route_long_name", "route_type": "route_type", "color": "route_color",
                       "text_color": "route_text_color"})
    for c in ("route_short_name", "route_long_name", "route_color", "route_text_color", "agency_id"):
        routes[c] = routes[c].fillna("").astype(str)
    trips = q(Trip, {"trip_id": "trip_id", "route_id": "route_id", "service_id": "service_id",
                     "headsign": "trip_headsign", "direction_id": "direction_id", "shape_id": "shape_id"})
    trips["shape_id"] = trips["shape_id"].fillna("").astype(str)
    st = q(StopTime, {"trip_id": "trip_id", "stop_id": "stop_id", "stop_sequence": "stop_sequence",
                      "arrival_s": "arrival_s", "departure_s": "departure_s",
                      "shape_dist_traveled": "shape_dist_traveled"}, ["trip_id", "stop_sequence"])
    cal = q(Calendar, {"service_id": "service_id", "days": "days", "start_date": "start_date", "end_date": "end_date"})
    cd = q(CalendarDate, {"service_id": "service_id", "date": "date", "exception_type": "exception_type"})
    for df, cols in ((cal, ["start_date", "end_date"]), (cd, ["date"])):
        for c in cols:
            df[c] = pd.to_datetime(df[c]).dt.date
    tr = q(Transfer, {"from_stop_id": "from_stop_id", "to_stop_id": "to_stop_id", "transfer_type": "transfer_type",
                      "min_transfer_time": "min_transfer_time"})
    shapes = q(ShapePoint, {"shape_id": "shape_id", "lat": "lat", "lon": "lon", "sequence": "sequence",
                            "dist_traveled": "dist_traveled"}, ["shape_id", "sequence"])
    fares = q(FareAttribute, {"fare_id": "fare_id", "price": "price", "currency_type": "currency_type"})
    agencies = q(Agency, {"agency_id": "agency_id", "name": "agency_name", "url": "agency_url",
                          "timezone": "agency_timezone"})
    ds = session.get(DatasetVersion, dataset_id)
    return Feed(agencies=agencies, stops=stops, routes=routes, trips=trips, stop_times=st, calendars=cal,
                calendar_dates=cd, transfers=tr, shapes=shapes, fares=fares, feed_version=ds.feed_version,
                timezone=ds.timezone, service_start=ds.service_start, service_end=ds.service_end)
