"""Parse and validate GTFS tables into clean, typed DataFrames plus a validation report.

Rows that break referential integrity are dropped *and reported*; nothing is invented to
fill gaps. A feed is rejected outright only when it cannot produce a usable network.
"""

import io
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime

import pandas as pd

from .archive import GtfsArchive

_TIME_RE = re.compile(r"^\s*(\d{1,3}):([0-5]\d):([0-5]\d)\s*$")
_HEX_RE = re.compile(r"^[0-9A-Fa-f]{6}$")
_SAMPLE = 5


class FeedError(ValueError):
    """The feed is structurally unusable."""


@dataclass
class Issue:
    code: str
    message: str
    count: int = 1
    samples: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "count": self.count, "samples": self.samples}


@dataclass
class ValidationReport:
    errors: list[Issue] = field(default_factory=list)
    warnings: list[Issue] = field(default_factory=list)
    info: dict = field(default_factory=dict)

    def error(self, code: str, message: str, samples=(), count: int | None = None) -> None:
        samples = [str(s) for s in list(samples)[:_SAMPLE]]
        self.errors.append(Issue(code, message, count if count is not None else max(len(samples), 1), samples))

    def warn(self, code: str, message: str, samples=(), count: int | None = None) -> None:
        samples = [str(s) for s in list(samples)[:_SAMPLE]]
        self.warnings.append(Issue(code, message, count if count is not None else max(len(samples), 1), samples))

    def as_dict(self) -> dict:
        return {"errors": [e.as_dict() for e in self.errors],
                "warnings": [w.as_dict() for w in self.warnings],
                "info": self.info}


@dataclass
class Feed:
    agencies: pd.DataFrame
    stops: pd.DataFrame
    routes: pd.DataFrame
    trips: pd.DataFrame
    stop_times: pd.DataFrame
    calendars: pd.DataFrame
    calendar_dates: pd.DataFrame
    transfers: pd.DataFrame
    shapes: pd.DataFrame
    fares: pd.DataFrame
    feed_version: str | None
    timezone: str | None
    service_start: date | None
    service_end: date | None


def normalize_name(name: str) -> str:
    """Search key: accent-free, lower case, punctuation collapsed. Display names are kept separately."""
    text = unicodedata.normalize("NFKD", name)
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def tidy_display(name: str) -> str:
    return re.sub(r"\s+", " ", name).strip()


def parse_gtfs_time(value: str) -> int | None:
    m = _TIME_RE.match(value or "")
    if not m:
        return None
    h, mi, s = (int(g) for g in m.groups())
    return h * 3600 + mi * 60 + s


def _parse_date(value: str) -> date | None:
    try:
        return datetime.strptime(value.strip(), "%Y%m%d").date()
    except (ValueError, AttributeError):
        return None


def _read(archive: GtfsArchive, name: str, report: ValidationReport) -> pd.DataFrame | None:
    raw = archive.files.get(name)
    if raw is None:
        return None
    try:
        df = pd.read_csv(io.BytesIO(raw), dtype=str, keep_default_na=False, encoding="utf-8-sig",
                         skipinitialspace=True)
    except Exception as exc:  # pandas raises several parser error types
        report.error("unreadable_file", f"{name} could not be parsed as CSV: {exc.__class__.__name__}")
        return None
    df.columns = [c.strip().lower() for c in df.columns]
    for col in df.columns:
        df[col] = df[col].astype(str).str.strip()
    return df


def _require_columns(df: pd.DataFrame, name: str, cols: list[str], report: ValidationReport) -> bool:
    missing = [c for c in cols if c not in df.columns]
    if missing:
        report.error("missing_columns", f"{name} lacks required column(s): {', '.join(missing)}")
        return False
    return True


def _col(df: pd.DataFrame, name: str, default: str = "") -> pd.Series:
    return df[name] if name in df.columns else pd.Series([default] * len(df), index=df.index, dtype=str)


def _dedupe(df: pd.DataFrame, key: list[str], label: str, report: ValidationReport) -> pd.DataFrame:
    dup = df.duplicated(subset=key, keep="first")
    if dup.any():
        report.warn("duplicate_records", f"{label}: {int(dup.sum())} duplicate {'/'.join(key)} row(s) dropped "
                    "(first occurrence kept).", df.loc[dup, key[0]].tolist(), int(dup.sum()))
    return df.loc[~dup].copy()


def parse_feed(archive: GtfsArchive) -> tuple[Feed, ValidationReport]:
    report = ValidationReport()
    present = sorted(archive.files)
    report.info["files_present"] = present
    report.info["files_ignored"] = archive.ignored
    optional = ["agency.txt", "calendar.txt", "calendar_dates.txt", "transfers.txt", "shapes.txt",
                "fare_attributes.txt", "feed_info.txt"]
    report.info["optional_missing"] = [f for f in optional if f not in archive.files]

    # ---- agency ----
    agency = _read(archive, "agency.txt", report)
    tz = None
    if agency is not None and len(agency):
        agency = agency.assign(agency_id=_col(agency, "agency_id"), agency_name=_col(agency, "agency_name"),
                               agency_url=_col(agency, "agency_url"), agency_timezone=_col(agency, "agency_timezone"))
        tzs = {t for t in agency["agency_timezone"] if t}
        tz = next(iter(tzs), None)
        if len(tzs) > 1:
            report.warn("multiple_timezones", "Agencies declare different timezones; the first is used.", tzs)
    else:
        agency = pd.DataFrame(columns=["agency_id", "agency_name", "agency_url", "agency_timezone"])
        report.warn("no_agency", "agency.txt is missing or empty; the feed timezone is unknown.")

    # ---- stops ----
    stops = _read(archive, "stops.txt", report)
    if stops is None or not _require_columns(stops, "stops.txt", ["stop_id"], report):
        raise FeedError("stops.txt is unusable.")
    stops = stops[stops["stop_id"] != ""]
    stops = _dedupe(stops, ["stop_id"], "stops.txt", report)
    stops["stop_name"] = _col(stops, "stop_name")
    unnamed = stops["stop_name"] == ""
    if unnamed.any():
        report.warn("missing_stop_name", "Stops without a name are shown by their stop_id.",
                    stops.loc[unnamed, "stop_id"], int(unnamed.sum()))
        stops.loc[unnamed, "stop_name"] = stops.loc[unnamed, "stop_id"]
    stops["display_name"] = stops["stop_name"].map(tidy_display)
    stops["name_normalized"] = stops["stop_name"].map(normalize_name)
    stops["lat"] = pd.to_numeric(_col(stops, "stop_lat"), errors="coerce")
    stops["lon"] = pd.to_numeric(_col(stops, "stop_lon"), errors="coerce")
    bad_coord = (stops["lat"].isna() | stops["lon"].isna() | (stops["lat"].abs() > 90) |
                 (stops["lon"].abs() > 180) | ((stops["lat"] == 0) & (stops["lon"] == 0)))
    if bad_coord.any():
        report.warn("invalid_coordinates", "Stops with missing or impossible coordinates cannot be mapped or "
                    "used by geographic heuristics.", stops.loc[bad_coord, "stop_id"], int(bad_coord.sum()))
        stops.loc[bad_coord, ["lat", "lon"]] = None
    stops["location_type"] = pd.to_numeric(_col(stops, "location_type", "0").replace("", "0"),
                                           errors="coerce").fillna(0).astype(int)
    stops["parent_station"] = _col(stops, "parent_station")
    stops["code"] = _col(stops, "stop_code")
    stops["wheelchair_boarding"] = pd.to_numeric(_col(stops, "wheelchair_boarding"), errors="coerce")
    orphan_parent = (stops["parent_station"] != "") & ~stops["parent_station"].isin(stops["stop_id"])
    if orphan_parent.any():
        report.warn("orphan_parent_station", "parent_station references an unknown stop; treated as standalone.",
                    stops.loc[orphan_parent, "stop_id"], int(orphan_parent.sum()))
        stops.loc[orphan_parent, "parent_station"] = ""

    # ---- routes ----
    routes = _read(archive, "routes.txt", report)
    if routes is None or not _require_columns(routes, "routes.txt", ["route_id"], report):
        raise FeedError("routes.txt is unusable.")
    routes = routes[routes["route_id"] != ""]
    routes = _dedupe(routes, ["route_id"], "routes.txt", report)
    for c in ["agency_id", "route_short_name", "route_long_name", "route_type", "route_color", "route_text_color"]:
        routes[c] = _col(routes, c)
    bad_color = (routes["route_color"] != "") & ~routes["route_color"].str.match(_HEX_RE)
    if bad_color.any():
        report.warn("invalid_route_color", "Malformed route_color values ignored.",
                    routes.loc[bad_color, "route_id"], int(bad_color.sum()))
        routes.loc[bad_color, "route_color"] = ""
    if (routes["route_color"] == "").all():
        report.warn("no_route_colors", "The feed provides no route_color values; display colours are derived "
                    "(see each line's colour_source).")
    routes["route_type"] = pd.to_numeric(routes["route_type"], errors="coerce")

    # ---- calendars ----
    calendars = _read(archive, "calendar.txt", report)
    cal_rows = []
    if calendars is not None and len(calendars):
        days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        if _require_columns(calendars, "calendar.txt", ["service_id", *days, "start_date", "end_date"], report):
            for r in calendars.itertuples(index=False):
                s, e = _parse_date(r.start_date), _parse_date(r.end_date)
                if not r.service_id or s is None or e is None or e < s:
                    report.warn("invalid_calendar", "Calendar row with invalid service_id or dates dropped.",
                                [r.service_id])
                    continue
                pattern = "".join("1" if getattr(r, d) == "1" else "0" for d in days)
                cal_rows.append({"service_id": r.service_id, "days": pattern, "start_date": s, "end_date": e})
    calendars = pd.DataFrame(cal_rows, columns=["service_id", "days", "start_date", "end_date"])
    calendars = _dedupe(calendars, ["service_id"], "calendar.txt", report) if len(calendars) else calendars

    cdates = _read(archive, "calendar_dates.txt", report)
    cd_rows = []
    if cdates is not None and len(cdates) and _require_columns(
            cdates, "calendar_dates.txt", ["service_id", "date", "exception_type"], report):
        for r in cdates.itertuples(index=False):
            d = _parse_date(r.date)
            if d is None or r.exception_type not in ("1", "2"):
                report.warn("invalid_calendar_date", "calendar_dates row with bad date/exception_type dropped.",
                            [f"{r.service_id}@{r.date}"])
                continue
            cd_rows.append({"service_id": r.service_id, "date": d, "exception_type": int(r.exception_type)})
    calendar_dates = pd.DataFrame(cd_rows, columns=["service_id", "date", "exception_type"])
    if not len(calendars) and not len(calendar_dates):
        report.warn("no_calendar", "No service calendar: schedule-aware (time-dependent) routing is disabled.")

    # ---- trips ----
    trips = _read(archive, "trips.txt", report)
    if trips is None or not _require_columns(trips, "trips.txt", ["trip_id", "route_id"], report):
        raise FeedError("trips.txt is unusable.")
    trips = trips[trips["trip_id"] != ""]
    trips = _dedupe(trips, ["trip_id"], "trips.txt", report)
    for c in ["service_id", "trip_headsign", "direction_id", "shape_id"]:
        trips[c] = _col(trips, c)
    bad_route = ~trips["route_id"].isin(routes["route_id"])
    if bad_route.any():
        report.warn("trip_unknown_route", "Trips referencing unknown routes dropped.",
                    trips.loc[bad_route, "trip_id"], int(bad_route.sum()))
        trips = trips[~bad_route]
    known_services = set(calendars["service_id"]) | set(calendar_dates["service_id"])
    if known_services:
        bad_service = ~trips["service_id"].isin(known_services)
        if bad_service.any():
            report.warn("trip_unknown_service", "Trips whose service_id has no calendar entry never run in "
                        "schedule-aware routing.", trips.loc[bad_service, "trip_id"], int(bad_service.sum()))
    trips["direction_id"] = pd.to_numeric(trips["direction_id"], errors="coerce")

    # ---- stop_times ----
    st = _read(archive, "stop_times.txt", report)
    if st is None or not _require_columns(st, "stop_times.txt", ["trip_id", "stop_id", "stop_sequence"], report):
        raise FeedError("stop_times.txt is unusable.")
    st["arrival_s"] = _col(st, "arrival_time").map(parse_gtfs_time)
    st["departure_s"] = _col(st, "departure_time").map(parse_gtfs_time)
    st["arrival_s"] = st["arrival_s"].fillna(st["departure_s"])
    st["departure_s"] = st["departure_s"].fillna(st["arrival_s"])
    st["stop_sequence"] = pd.to_numeric(st["stop_sequence"], errors="coerce")
    st["shape_dist_traveled"] = pd.to_numeric(_col(st, "shape_dist_traveled"), errors="coerce")
    n0 = len(st)
    bad_seq = st["stop_sequence"].isna()
    if bad_seq.any():
        report.warn("invalid_stop_sequence", "stop_times rows without a numeric stop_sequence dropped.",
                    st.loc[bad_seq, "trip_id"], int(bad_seq.sum()))
        st = st[~bad_seq]
    bad_trip = ~st["trip_id"].isin(trips["trip_id"])
    if bad_trip.any():
        report.warn("stop_time_unknown_trip", "stop_times rows referencing unknown/dropped trips removed.",
                    st.loc[bad_trip, "trip_id"].unique(), int(bad_trip.sum()))
        st = st[~bad_trip]
    bad_stop = ~st["stop_id"].isin(stops["stop_id"])
    if bad_stop.any():
        report.warn("stop_time_unknown_stop", "stop_times rows referencing unknown stops removed.",
                    st.loc[bad_stop, "stop_id"].unique(), int(bad_stop.sum()))
        st = st[~bad_stop]
    st = _dedupe(st, ["trip_id", "stop_sequence"], "stop_times.txt", report)
    st["stop_sequence"] = st["stop_sequence"].astype(int)
    st = st.sort_values(["trip_id", "stop_sequence"], kind="stable")
    untimed = st["arrival_s"].isna()
    if untimed.any():
        report.warn("untimed_stop_times", "Some stop_times have no arrival/departure; their hops get no "
                    "scheduled duration (no interpolation is performed).", st.loc[untimed, "trip_id"].unique(),
                    int(untimed.sum()))
    # Time must not go backwards within a trip.
    prev_dep = st.groupby("trip_id")["departure_s"].shift()
    backwards = st["arrival_s"].notna() & prev_dep.notna() & (st["arrival_s"] < prev_dep)
    if backwards.any():
        report.warn("non_monotonic_times", "Hops whose arrival precedes the previous departure are kept for "
                    "topology but excluded from travel-time estimates.", st.loc[backwards, "trip_id"].unique(),
                    int(backwards.sum()))
    st["time_valid"] = ~backwards
    report.info["stop_times_rows_read"] = n0
    short_trips = st.groupby("trip_id").size()
    short_trips = short_trips[short_trips < 2]
    if len(short_trips):
        report.warn("single_stop_trips", "Trips with fewer than two stops contribute no connections.",
                    short_trips.index, len(short_trips))
    max_s = st["arrival_s"].max()
    report.info["latest_scheduled_time"] = (None if pd.isna(max_s) else
                                            f"{int(max_s) // 3600:02d}:{int(max_s) % 3600 // 60:02d}")
    report.info["has_times_after_midnight"] = bool(pd.notna(max_s) and max_s >= 86400)

    unused = ~stops["stop_id"].isin(st["stop_id"]) & (stops["location_type"] == 0)
    if unused.any():
        report.warn("unserved_stops", "Stops never visited by any trip are listed but not routable.",
                    stops.loc[unused, "stop_id"], int(unused.sum()))

    # ---- transfers / shapes / fares (optional) ----
    transfers = _read(archive, "transfers.txt", report)
    if transfers is not None and len(transfers) and _require_columns(
            transfers, "transfers.txt", ["from_stop_id", "to_stop_id"], report):
        transfers["transfer_type"] = pd.to_numeric(_col(transfers, "transfer_type", "0").replace("", "0"),
                                                   errors="coerce").fillna(0).astype(int)
        transfers["min_transfer_time"] = pd.to_numeric(_col(transfers, "min_transfer_time"), errors="coerce")
        ok = transfers["from_stop_id"].isin(stops["stop_id"]) & transfers["to_stop_id"].isin(stops["stop_id"])
        if (~ok).any():
            report.warn("transfer_unknown_stop", "transfers.txt rows with unknown stops dropped.",
                        transfers.loc[~ok, "from_stop_id"], int((~ok).sum()))
        transfers = transfers[ok][["from_stop_id", "to_stop_id", "transfer_type", "min_transfer_time"]]
    else:
        transfers = pd.DataFrame(columns=["from_stop_id", "to_stop_id", "transfer_type", "min_transfer_time"])
        report.warn("no_transfers", "No transfers.txt: interchange walking time is unknown and modelled with a "
                    "configurable, explicitly labelled assumption.")

    shapes = _read(archive, "shapes.txt", report)
    if shapes is not None and len(shapes) and _require_columns(
            shapes, "shapes.txt", ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"], report):
        shapes = pd.DataFrame({
            "shape_id": shapes["shape_id"],
            "lat": pd.to_numeric(shapes["shape_pt_lat"], errors="coerce"),
            "lon": pd.to_numeric(shapes["shape_pt_lon"], errors="coerce"),
            "sequence": pd.to_numeric(shapes["shape_pt_sequence"], errors="coerce"),
            "dist_traveled": pd.to_numeric(_col(shapes, "shape_dist_traveled"), errors="coerce"),
        }).dropna(subset=["lat", "lon", "sequence"])
        shapes["sequence"] = shapes["sequence"].astype(int)
        shapes = shapes.sort_values(["shape_id", "sequence"])
    else:
        shapes = pd.DataFrame(columns=["shape_id", "lat", "lon", "sequence", "dist_traveled"])

    fares = _read(archive, "fare_attributes.txt", report)
    if fares is not None and len(fares) and {"fare_id", "price", "currency_type"} <= set(fares.columns):
        fares = fares.assign(price=pd.to_numeric(fares["price"], errors="coerce")).dropna(subset=["price"])
        fares = fares[["fare_id", "price", "currency_type"]]
    else:
        fares = pd.DataFrame(columns=["fare_id", "price", "currency_type"])
        report.info["fares"] = "No fare data in feed; fares are not shown."

    feed_version = None
    feed_info = _read(archive, "feed_info.txt", report)
    if feed_info is not None and len(feed_info) and "feed_version" in feed_info.columns:
        feed_version = feed_info["feed_version"].iloc[0] or None

    starts = list(calendars["start_date"]) + list(calendar_dates.loc[calendar_dates["exception_type"] == 1, "date"])
    ends = list(calendars["end_date"]) + list(calendar_dates.loc[calendar_dates["exception_type"] == 1, "date"])
    service_start = min(starts) if starts else None
    service_end = max(ends) if ends else None

    if not len(st):
        raise FeedError("No valid stop_times remain after validation; no network can be built.")

    report.info.update({
        "stops": int(len(stops)), "routes": int(len(routes)), "trips": int(len(trips)),
        "stop_times": int(len(st)), "calendars": int(len(calendars)), "calendar_dates": int(len(calendar_dates)),
        "transfers": int(len(transfers)), "shape_points": int(len(shapes)),
        "service_start": service_start.isoformat() if service_start else None,
        "service_end": service_end.isoformat() if service_end else None,
        "timezone": tz,
    })
    feed = Feed(agencies=agency, stops=stops, routes=routes, trips=trips, stop_times=st, calendars=calendars,
                calendar_dates=calendar_dates, transfers=transfers, shapes=shapes, fares=fares,
                feed_version=feed_version, timezone=tz, service_start=service_start, service_end=service_end)
    return feed, report
