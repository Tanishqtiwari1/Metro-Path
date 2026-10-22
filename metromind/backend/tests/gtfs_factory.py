"""Builds small synthetic GTFS archives for tests. Test fixtures only - never used at runtime."""

import io
import zipfile


def _csv(header: list[str], rows: list[list]) -> str:
    return "\n".join([",".join(header)] + [",".join("" if v is None else str(v) for v in r) for r in rows]) + "\n"


def hms(seconds: int) -> str:
    return f"{seconds // 3600:02d}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"


def build_zip(stops: list[tuple], routes: list[tuple], trips: list[dict], *, calendar: list[tuple] | None = None,
              calendar_dates: list[tuple] | None = None, extra: dict[str, str] | None = None,
              tz: str = "Asia/Kolkata", transfers: list[tuple] | None = None) -> bytes:
    """
    stops:  (stop_id, name, lat, lon)
    routes: (route_id, short_name, long_name)
    trips:  {"trip_id", "route_id", "service_id", "stops": [stop_id...], "start": seconds,
             "hop": seconds or list, "dwell": seconds, "dist": [cumulative metres] (optional)}
    """
    files = {
        "agency.txt": _csv(["agency_id", "agency_name", "agency_url", "agency_timezone"],
                           [["T", "Test Transit", "https://example.test", tz]]),
        "stops.txt": _csv(["stop_id", "stop_name", "stop_lat", "stop_lon"], [list(s) for s in stops]),
        "routes.txt": _csv(["route_id", "agency_id", "route_short_name", "route_long_name", "route_type"],
                           [[r[0], "T", r[1], r[2], 1] for r in routes]),
    }
    trip_rows, st_rows = [], []
    for t in trips:
        trip_rows.append([t["route_id"], t.get("service_id", "wk"), t["trip_id"], t.get("shape_id", "")])
        now = t["start"]
        hops = t.get("hop", 120)
        dwell = t.get("dwell", 20)
        for i, sid in enumerate(t["stops"]):
            arr = now
            dep = now + (dwell if 0 < i < len(t["stops"]) - 1 else 0)
            dist = t["dist"][i] if "dist" in t else ""
            st_rows.append([t["trip_id"], hms(arr), hms(dep), sid, i, dist])
            h = hops[i] if isinstance(hops, list) and i < len(hops) else hops
            now = dep + (h if not isinstance(h, list) else 0)
    files["trips.txt"] = _csv(["route_id", "service_id", "trip_id", "shape_id"], trip_rows)
    files["stop_times.txt"] = _csv(["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence",
                                    "shape_dist_traveled"], st_rows)
    if calendar is None:
        calendar = [("wk", "1111111", "20240101", "20301231")]
    if calendar:
        files["calendar.txt"] = _csv(
            ["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date",
             "end_date"], [[c[0], *list(c[1]), c[2], c[3]] for c in calendar])
    if calendar_dates:
        files["calendar_dates.txt"] = _csv(["service_id", "date", "exception_type"], [list(c) for c in calendar_dates])
    if transfers:
        files["transfers.txt"] = _csv(["from_stop_id", "to_stop_id", "transfer_type", "min_transfer_time"],
                                      [list(t) for t in transfers])
    files.update(extra or {})
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            # Fixed timestamps keep archives byte-identical, so identical feeds hash identically.
            zf.writestr(zipfile.ZipInfo(name, date_time=(2024, 1, 1, 0, 0, 0)), content,
                        compress_type=zipfile.ZIP_DEFLATED)
    return buf.getvalue()


# A small network:
#   Line A: S1 - S2 - S3 - S4          (both directions)
#   Line B: S5 - S3 - S6               (both directions)  -> S3 is an interchange
#   Line C: S1 - S7 - S6               (both directions, slow)
#   Line D: S8 - S9                    (disconnected component)
STOPS = [
    ("S1", "Alpha", 28.600, 77.200), ("S2", "Bravo Sec-2", 28.600, 77.210), ("S3", "Charlie Junction", 28.600, 77.220),
    ("S4", "Delta", 28.600, 77.230), ("S5", "Echo", 28.610, 77.220), ("S6", "Foxtrot", 28.590, 77.220),
    ("S7", "Golf", 28.590, 77.205), ("S8", "Hotel", 28.700, 77.400), ("S9", "India", 28.700, 77.410),
]
ROUTES = [("A1", "A_F", "AQUA_Alpha to Delta"), ("A2", "A_R", "AQUA_Delta to Alpha"),
          ("B1", "B_F", "BLUE_Echo to Foxtrot"), ("B2", "B_R", "BLUE_Foxtrot to Echo"),
          ("C1", "C_F", "CORAL_Alpha to Foxtrot"), ("C2", "C_R", "CORAL_Foxtrot to Alpha"),
          ("D1", "D_F", "DUSK_Hotel to India"), ("D2", "D_R", "DUSK_India to Hotel")]


def network_trips(day_start: int = 6 * 3600, headway: int = 600, count: int = 6) -> list[dict]:
    trips = []
    patterns = [("A1", ["S1", "S2", "S3", "S4"], 120), ("A2", ["S4", "S3", "S2", "S1"], 120),
                ("B1", ["S5", "S3", "S6"], 120), ("B2", ["S6", "S3", "S5"], 120),
                ("C1", ["S1", "S7", "S6"], 600), ("C2", ["S6", "S7", "S1"], 600),
                ("D1", ["S8", "S9"], 120), ("D2", ["S9", "S8"], 120)]
    for route, stops, hop in patterns:
        for k in range(count):
            trips.append({"trip_id": f"{route}_{k}", "route_id": route, "stops": stops,
                          "start": day_start + k * headway, "hop": hop, "dwell": 20})
    return trips


def standard_zip(**kw) -> bytes:
    return build_zip(STOPS, ROUTES, network_trips(), **kw)
