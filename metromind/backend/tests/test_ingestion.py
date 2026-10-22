import io
import zipfile

import pytest

from app.ingestion.archive import ArchiveError, read_archive
from app.ingestion.parser import FeedError, normalize_name, parse_feed, parse_gtfs_time

from .conftest import network_from_zip
from .gtfs_factory import ROUTES, STOPS, build_zip, network_trips, standard_zip

LIMITS = dict(max_uncompressed_bytes=50 << 20, max_ratio=500)


def _zip(files: dict[str, str | bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for n, c in files.items():
            zf.writestr(n, c)
    return buf.getvalue()


def test_rejects_non_zip_and_empty():
    with pytest.raises(ArchiveError):
        read_archive(b"", **LIMITS)
    with pytest.raises(ArchiveError):
        read_archive(b"not a zip at all", **LIMITS)


def test_rejects_path_traversal():
    with pytest.raises(ArchiveError, match="Unsafe path"):
        read_archive(_zip({"../stops.txt": "x"}), **LIMITS)
    with pytest.raises(ArchiveError, match="Unsafe path"):
        read_archive(_zip({"/etc/stops.txt": "x"}), **LIMITS)


def test_rejects_missing_required_files():
    with pytest.raises(ArchiveError, match="Missing required"):
        read_archive(_zip({"stops.txt": "stop_id\n1\n"}), **LIMITS)


def test_rejects_zip_bomb_ratio():
    data = _zip({"stops.txt": "a" * 2_000_000, "routes.txt": "x", "trips.txt": "x", "stop_times.txt": "x"})
    with pytest.raises(ArchiveError, match="compression ratio"):
        read_archive(data, max_uncompressed_bytes=50 << 20, max_ratio=50)


def test_ignores_macos_junk_and_nested_folder():
    base = zipfile.ZipFile(io.BytesIO(standard_zip()))
    files = {f"feed/{n}": base.read(n) for n in base.namelist()}
    files["__MACOSX/._stops.txt"] = b"junk"
    arch = read_archive(_zip(files), **LIMITS)
    assert "stops.txt" in arch.files
    assert "__MACOSX/._stops.txt" in arch.ignored


def test_gtfs_time_parsing_beyond_midnight():
    assert parse_gtfs_time("25:13:01") == 25 * 3600 + 13 * 60 + 1
    assert parse_gtfs_time("5:00:00") == 5 * 3600
    assert parse_gtfs_time("bad") is None


def test_normalize_name_keeps_search_key_only():
    assert normalize_name("  Noida Sec-62 ") == "noida sec 62"
    assert normalize_name("Café  Ünion") == "cafe union"


def test_duplicates_and_bad_references_are_reported_and_dropped():
    stops = STOPS + [("S1", "Alpha duplicate", 1, 1), ("SX", "Nowhere", 0, 0)]
    trips = network_trips(count=1) + [{"trip_id": "ghost", "route_id": "NOPE", "stops": ["S1", "S2"], "start": 0}]
    data = build_zip(stops, ROUTES, trips)
    feed, report = parse_feed(read_archive(data, **LIMITS))
    codes = {w.code for w in report.warnings}
    assert "duplicate_records" in codes
    assert "trip_unknown_route" in codes
    assert "invalid_coordinates" in codes  # (0, 0) is not a real location
    assert "unserved_stops" in codes
    assert feed.stops["stop_id"].tolist().count("S1") == 1
    assert feed.stops.set_index("stop_id").loc["S1", "stop_name"] == "Alpha"  # first occurrence kept
    assert "ghost" not in set(feed.trips["trip_id"])


def test_missing_values_reported():
    extra = {"stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
                               "A1_0,06:00:00,06:00:00,S1,0\nA1_0,,,S2,1\nA1_0,06:05:00,06:05:00,S3,x\n"
                               "A1_0,06:04:00,06:04:00,S4,3\n"}
    data = build_zip(STOPS, ROUTES, network_trips(count=1), extra=extra)
    feed, report = parse_feed(read_archive(data, **LIMITS))
    codes = {w.code for w in report.warnings}
    assert "invalid_stop_sequence" in codes
    assert "untimed_stop_times" in codes


def test_empty_network_is_rejected():
    extra = {"stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"}
    with pytest.raises(FeedError):
        parse_feed(read_archive(build_zip(STOPS, ROUTES, [], extra=extra), **LIMITS))


def test_edges_follow_service_patterns_not_ids_or_geography(net):
    # S1 and S3 are both on line A but never consecutive -> no edge.
    assert ("S1", "S2") in net.edges and ("S2", "S3") in net.edges
    assert ("S1", "S3") not in net.edges
    # S7 (Golf) is geographically between S1 and S6 but only connected via line C.
    assert set(net.neighbors_of("S7")) == {"S1", "S6"}
    # Arrival-to-arrival scheduled times derived from stop_times.
    assert net.edges[("S1", "S2")].route_times == {"A1": 120.0}
    assert net.edges[("S2", "S3")].route_times == {"A1": 140.0}


def test_interchange_and_line_grouping(net):
    assert net.stations["S3"].lines == {"aqua", "blue"}
    assert set(net.lines) == {"aqua", "blue", "coral", "dusk"}
    assert net.lines["aqua"].color_source == "inferred_from_name"
    assert net.lines["dusk"].color_source == "fallback_palette"
    assert sorted(net.lines["aqua"].route_ids) == ["A1", "A2"]


def test_station_search_handles_abbreviations(net):
    assert net.search_stations("bravo sector 2", 1)[0].id == "S2"
    assert net.search_stations("charlie", 5)[0].id == "S3"
    assert net.search_stations("charlei junction", 5)[0].id == "S3"  # fuzzy
    assert net.search_stations("zzzz", 5) == []


def test_changing_dataset_changes_network_without_code_changes():
    stops = [("X1", "Xenon", 10.0, 10.0), ("X2", "Yttrium", 10.0, 10.01)]
    trips = [{"trip_id": "t", "route_id": "R", "stops": ["X1", "X2"], "start": 3600}]
    other = network_from_zip(build_zip(stops, [("R", "R", "RED_Xenon to Yttrium")], trips))
    assert set(other.stations) == {"X1", "X2"}
    assert ("X1", "X2") in other.edges and ("X2", "X1") not in other.edges  # one-way service stays one-way


def test_parent_stations_merge_platforms():
    stops_txt = ("stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n"
                 "P,Parent,28.6,77.2,1,\nP1,Parent P1,28.6,77.2,0,P\nP2,Parent P2,28.6,77.2,0,P\n"
                 "Q,Q,28.6,77.21,0,\nR,R,28.61,77.2,0,\n")
    trips = [{"trip_id": "a", "route_id": "A1", "stops": ["P1", "Q"], "start": 3600},
             {"trip_id": "b", "route_id": "B1", "stops": ["R", "P2"], "start": 3600}]
    n = network_from_zip(build_zip([], ROUTES, trips, extra={"stops.txt": stops_txt}))
    assert "P1" not in n.stations and "P" in n.stations
    assert ("P", "Q") in n.edges and ("R", "P") in n.edges
    assert n.stations["P"].lines == {"aqua", "blue"}
