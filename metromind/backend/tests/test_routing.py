from datetime import date

import pytest

from app.routing import planner as P
from app.routing.evaluate import InvalidPath, evaluate
from app.routing.spaces import Objective

from .conftest import network_from_zip
from .gtfs_factory import ROUTES, STOPS, build_zip, network_trips

# Expected costs on the fixture network (see gtfs_factory):
#   S1 -> S6 via A (S1-S2-S3, 120+140) + change at S3 (300) + B (S3-S6, 140)  = 700 s, 1 change, 3 hops
#   S1 -> S6 via C (S1-S7-S6, 600+620)                                         = 1220 s, 0 changes, 2 hops


@pytest.mark.parametrize("algo", ["dijkstra", "astar"])
def test_time_objective_counts_transfer_penalty(net, algo):
    res, j = P.run_algorithm(net, algo, "S1", "S6", Objective("time", 300))
    assert res.found
    assert [s["id"] for s in j["stations"]] == ["S1", "S2", "S3", "S6"]
    m = j["metrics"]
    assert m["transfers"] == 1 and m["line_changes"] == 1
    assert m["in_vehicle_s"] == 400 and m["transfer_allowance_s"] == 300 and m["total_time_s"] == 700
    assert [r["line_id"] for r in j["rides"]] == ["aqua", "blue"]
    assert [s["role"] for s in j["stations"]] == ["origin", "pass", "transfer", "destination"]


def test_large_penalty_prefers_direct_line(net):
    _, j = P.run_algorithm(net, "dijkstra", "S1", "S6", Objective("time", 1000))
    assert [s["id"] for s in j["stations"]] == ["S1", "S7", "S6"] and j["metrics"]["transfers"] == 0


@pytest.mark.parametrize("algo", ["dijkstra", "astar"])
def test_transfers_objective_is_lexicographic(net, algo):
    _, j = P.run_algorithm(net, algo, "S1", "S6", Objective("transfers", 300))
    assert j["metrics"]["objective_cost"] == [0, 1220.0]


def test_max_transfers_is_enforced_exactly(net):
    res, j = P.run_algorithm(net, "dijkstra", "S1", "S6", Objective("time", 300), max_transfers=0)
    assert j["metrics"]["transfers"] == 0 and j["constraints_satisfied"]
    res, _ = P.run_algorithm(net, "dijkstra", "S2", "S5", Objective("time", 300), max_transfers=0)
    assert not res.found  # S2 -> S5 needs A then B


def test_bfs_and_stops_objective(net):
    _, j = P.run_algorithm(net, "bfs", "S1", "S6", Objective("stops"))
    assert j["metrics"]["stops"] == 2
    _, j2 = P.run_algorithm(net, "dijkstra", "S1", "S6", Objective("stops"))
    assert j2["metrics"]["objective_cost"] == 2


def test_gbfs_result_is_costed_under_objective(net):
    _, j = P.run_algorithm(net, "gbfs", "S1", "S6", Objective("time", 300))
    assert j["metrics"]["objective"] == "time"
    assert j["metrics"]["objective_cost"] >= 700  # never better than the optimum


def test_evaluate_assigns_lines_with_minimum_changes(net):
    j = evaluate(net, Objective("time", 300), ["S4", "S3", "S2", "S1"])
    assert len(j["rides"]) == 1 and j["rides"][0]["route_id"] == "A2"
    j = evaluate(net, Objective("time", 300), ["S5", "S3", "S2"])
    assert j["metrics"]["transfers"] == 1
    assert j["transfers_detail"] == [{"station": "S3", "seconds": 300.0, "source": "assumed"}]


def test_evaluate_rejects_paths_without_service(net):
    with pytest.raises(InvalidPath):
        evaluate(net, Objective("time"), ["S1", "S3"])


def test_disconnected_component_is_unreachable(net):
    for algo in ("gbfs", "bfs", "dijkstra", "astar"):
        res, j = P.run_algorithm(net, algo, "S1", "S8", Objective("time"))
        assert not res.found and j is None


def test_auto_selection(net):
    assert P.auto_select(net, Objective("stops"), "S1", "S6", False)[0] == "bfs"
    assert P.auto_select(net, Objective("time"), "S1", "S6", False)[0] == "astar"
    assert P.auto_select(net, Objective("time"), "S1", "S6", True)[0] == "csa"


def test_alternatives_are_distinct(net):
    _, primary = P.run_algorithm(net, "astar", "S1", "S6", Objective("time", 300))
    alts = P.alternatives(net, Objective("time", 300), "S1", "S6", primary, k=3, max_transfers=None)
    seqs = [tuple(s["id"] for s in a["stations"]) for a in alts]
    assert len(seqs) == len(set(seqs))
    assert ("S1", "S2", "S3", "S6") not in seqs
    assert ("S1", "S7", "S6") in seqs
    assert alts[0]["tradeoff"]


def test_compare_reports_optimality(net):
    out = P.compare(net, "S1", "S6", Objective("time", 300), ["gbfs", "bfs", "dijkstra", "astar"], repeats=3,
                    max_transfers=None, timeout_s=5)
    by = {r["algorithm"]: r for r in out["results"]}
    assert by["dijkstra"]["optimality"]["status"] == "optimal" and by["dijkstra"]["optimality"]["guaranteed"]
    assert by["astar"]["optimality"]["status"] == "optimal"
    assert by["bfs"]["optimality"]["status"] == "suboptimal"  # BFS picks the 2-hop, 1220 s route
    assert by["bfs"]["optimality"]["gap"] == pytest.approx(520)
    assert all(r["timing_ms"]["runs"] == 3 for r in out["results"])


# ----------------------------------------------------------------- schedule-aware (CSA)

def test_csa_earliest_arrival_with_transfer_slack(net):
    # Wednesday 2025-01-01 is inside the calendar. Depart S1 06:00.
    j = P.plan_schedule(net, "S1", "S6", date(2025, 1, 1), 6 * 3600, min_transfer_s=60)
    assert j["metrics"]["transfers"] in (0, 1)
    legs = j["legs"]
    # A1_0 departs S1 06:00, reaches S3 at 06:04:20; B1 trips reach S3 at 06:02 + k*10min,
    # so with 60 s slack the first catchable B1 is B1_1 (06:12:00 at S3, departs 06:12:20).
    assert legs[0]["route_id"] == "A1" and legs[0]["departure"] == "06:00:00"
    assert legs[1]["route_id"] == "B1" and legs[1]["departure"] == "06:12:20"
    assert j["metrics"]["arrival"] == "06:14:20"
    assert legs[0]["wait_before_s"] == 0
    assert legs[1]["wait_before_s"] == 480 == j["metrics"]["waiting_s"]


def test_csa_respects_calendar_exceptions():
    removed = build_zip(STOPS, ROUTES, network_trips(), calendar_dates=[("wk", "20250101", 2)])
    n = network_from_zip(removed)
    with pytest.raises(P.RoutingError) as e:
        P.plan_schedule(n, "S1", "S4", date(2025, 1, 1), 6 * 3600, min_transfer_s=60)
    assert e.value.code == "no_service_on_date"
    # A service that only runs via an added exception date.
    added = build_zip(STOPS, ROUTES, [dict(t, service_id="special") for t in network_trips()],
                      calendar=[], calendar_dates=[("special", "20250105", 1)])
    n2 = network_from_zip(added)
    assert P.plan_schedule(n2, "S1", "S4", date(2025, 1, 5), 6 * 3600, min_transfer_s=60)["legs"]
    with pytest.raises(P.RoutingError):
        P.plan_schedule(n2, "S1", "S4", date(2025, 1, 6), 6 * 3600, min_transfer_s=60)


def test_csa_outside_validity_window_suggests_date(net):
    with pytest.raises(P.RoutingError) as e:
        P.plan_schedule(net, "S1", "S4", date(2035, 6, 6), 6 * 3600, min_transfer_s=60)
    assert e.value.details["suggested_date"] is not None
    assert e.value.details["in_validity_window"] is False


def test_csa_handles_times_after_midnight():
    # One trip starting 24:30:00 on the service day of 2025-01-01 (i.e. 00:30 on 2025-01-02).
    trips = [{"trip_id": "late", "route_id": "A1", "stops": ["S1", "S2"], "start": 24 * 3600 + 1800}]
    n = network_from_zip(build_zip(STOPS, ROUTES, trips, calendar=[("wk", "0010000", "20250101", "20250101")]))
    # 2025-01-01 is a Wednesday; query on Thursday 00:20 must find yesterday's 24:30 trip.
    j = P.plan_schedule(n, "S1", "S2", date(2025, 1, 2), 20 * 60, min_transfer_s=60)
    assert j["legs"][0]["departure"] == "00:30:00"
    assert j["metrics"]["total_time_s"] == 600 + 120


def test_schedule_status(net):
    s = P.schedule_status(net, date(2025, 3, 3))
    assert s["has_service"] and s["in_validity_window"]


def test_csa_spillover_only_covers_early_hours():
    # Regression: a date with no trips of its own must not count as "in service" all day just because
    # the previous day's trips run past midnight.
    trips = [{"trip_id": "late", "route_id": "A1", "stops": ["S1", "S2"], "start": 24 * 3600 + 1800}]
    n = network_from_zip(build_zip(STOPS, ROUTES, trips, calendar=[("wk", "0010000", "20250101", "20250101")]))
    with pytest.raises(P.RoutingError) as e:
        P.plan_schedule(n, "S1", "S2", date(2025, 1, 2), 8 * 3600, min_transfer_s=60)
    assert e.value.code == "no_service_on_date"


def test_csa_day_without_own_trips_is_refused():
    weekdays_only = build_zip(STOPS, ROUTES, network_trips(), calendar=[("wk", "1111100", "20250101", "20251231")])
    n = network_from_zip(weekdays_only)
    with pytest.raises(P.RoutingError) as e:
        P.plan_schedule(n, "S1", "S4", date(2025, 1, 4), 8 * 3600, min_transfer_s=60)  # Saturday
    assert e.value.code == "no_service_on_date" and e.value.details["suggested_date"]


def test_csa_warns_when_journey_departs_next_day(net):
    j = P.plan_schedule(net, "S1", "S4", date(2025, 1, 1), 23 * 3600, min_transfer_s=60)
    assert j["legs"][0]["departure"].endswith("(+1d)")
    assert j["warnings"] and "next day" in j["warnings"][0]
