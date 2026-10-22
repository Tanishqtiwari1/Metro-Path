"""Route planning orchestration: algorithm dispatch, automatic selection, alternatives,
schedule-aware journeys and algorithm benchmarking."""

import bisect
import heapq
import itertools
import statistics
import time
import tracemalloc
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import networkx as nx

from ..algorithms.astar import a_star
from ..algorithms.base import SearchResult, Trace
from ..algorithms.bfs import breadth_first_search
from ..algorithms.csa import connection_scan
from ..algorithms.dijkstra import dijkstra
from ..algorithms.gbfs import greedy_best_first_search
from ..graph.network import TransitNetwork
from ..graph.nx_export import station_digraph
from .evaluate import evaluate
from .spaces import Objective, space_for

ALGORITHMS = {
    "gbfs": greedy_best_first_search,
    "bfs": breadth_first_search,
    "dijkstra": dijkstra,
    "astar": a_star,
}

ALGORITHM_INFO = {
    "gbfs": {"name": "Greedy Best-First Search", "informed": True, "optimal": False,
             "complexity": "O(b^m) time and space in the worst case; O((V+E) log V) with a discovered set",
             "summary": "Expands the node with the smallest heuristic h(n) (straight-line distance to the "
                        "destination). Ignores the cost already travelled, so it is fast but not optimal."},
    "bfs": {"name": "Breadth-First Search", "informed": False, "optimal": "for hop count only",
            "complexity": "O(V + E)",
            "summary": "Explores level by level; returns the route with the fewest station-to-station hops. "
                       "Fewest hops is not the same as fastest."},
    "dijkstra": {"name": "Dijkstra", "informed": False, "optimal": True,
                 "complexity": "O((V + E) log V) with a binary heap",
                 "summary": "Expands nodes in order of accumulated cost g(n). Optimal for any non-negative "
                            "edge weights (time, distance, lexicographic costs)."},
    "astar": {"name": "A*", "informed": True, "optimal": "when h is admissible and consistent",
              "complexity": "O((V + E) log V) worst case; usually far fewer expansions than Dijkstra",
              "summary": "Expands by f(n) = g(n) + h(n). h is the straight-line distance converted to the "
                         "objective's units with the network's best observed cost per metre, which never "
                         "overestimates, so A* remains optimal."},
    "csa": {"name": "Connection Scan (schedule-aware)", "informed": False, "optimal": "earliest arrival",
            "complexity": "O(#connections) per query",
            "summary": "Scans every timetabled train hop in departure order from the chosen time; returns the "
                       "earliest possible arrival respecting the actual timetable and service calendar."},
}


class RoutingError(ValueError):
    def __init__(self, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


def check_endpoints(net: TransitNetwork, origin: str, destination: str) -> None:
    for label, sid in (("origin", origin), ("destination", destination)):
        if sid not in net.stations:
            raise RoutingError("unknown_station", f"Unknown {label} station id {sid!r}.")
        if sid not in net.routable:
            raise RoutingError("station_not_served", f"{net.stations[sid].name} is not served by any trip in "
                               "the active dataset.")


def make_trace(enabled: bool, settings) -> Trace | None:
    if not enabled:
        return None
    return Trace(settings.trace_max_events, settings.trace_frontier_preview)


def run_algorithm(net: TransitNetwork, algorithm: str, origin: str, destination: str, objective: Objective, *,
                  max_transfers: int | None = None, trace: Trace | None = None,
                  timeout_s: float | None = None) -> tuple[SearchResult, dict | None]:
    fn = ALGORITHMS.get(algorithm)
    if fn is None:
        raise RoutingError("unknown_algorithm", f"Unknown algorithm {algorithm!r}.")
    space = space_for(net, objective, algorithm, max_transfers=max_transfers)
    result = fn(space, origin, destination, trace=trace, timeout_s=timeout_s)
    journey = None
    if result.found:
        states = result.states if result.states and isinstance(result.states[0], tuple) else None
        journey = evaluate(net, objective, result.stations, states, max_transfers=max_transfers)
    return result, journey


def auto_select(net: TransitNetwork, objective: Objective, origin: str, destination: str,
                schedule_requested: bool) -> tuple[str, str]:
    if schedule_requested:
        if net.schedule_supported:
            return "csa", "A departure time was given and the feed has a usable timetable, so the timetable-aware " \
                          "Connection Scan Algorithm gives the true earliest arrival."
    if objective.kind == "stops":
        return "bfs", "Hop count is an unweighted objective; BFS is optimal for it and needs no priority queue."
    a, b = net.stations[origin], net.stations[destination]
    if a.has_coords and b.has_coords and net.min_s_per_m > 0:
        return "astar", ("Both stations have coordinates, so an admissible straight-line heuristic is available; "
                         "A* returns the same optimum as Dijkstra while usually expanding fewer states.")
    return "dijkstra", "No usable coordinates for a heuristic, so Dijkstra (uninformed, optimal) is used."


def serialize_search(result: SearchResult, net: TransitNetwork) -> dict:
    info = ALGORITHM_INFO[result.algorithm]
    out = {
        "algorithm": result.algorithm,
        "algorithm_name": info["name"],
        "found": result.found,
        "runtime_ms": round(result.runtime_ms, 3),
        "expanded": result.expanded,
        "generated": result.generated,
        "discovered": result.discovered,
        "max_frontier": result.max_frontier,
        "expansion_order": result.expansion_order,
    }
    if result.trace is not None:
        out["trace"] = {"events": result.trace.events, "truncated": result.trace.truncated,
                        "max_events": result.trace.max_events}
    return out


# ---------------------------------------------------------------- alternatives
def _edge_set(stations: list[str]) -> set[tuple[str, str]]:
    return set(zip(stations, stations[1:]))


def alternatives(net: TransitNetwork, objective: Objective, origin: str, destination: str, primary: dict, *,
                 k: int, max_transfers: int | None, time_budget_s: float = 2.0) -> list[dict]:
    """Up to k distinct, meaningfully different feasible routes.

    Candidates come from Yen's k-shortest simple paths on the station graph (time-weighted)
    plus the fewest-transfers route; each is costed under the selected objective. Paths that
    share more than 80% of their edges with an already chosen route are skipped, so
    alternatives are not trivial one-station detours. Enumeration is bounded by count and time.
    """
    g = station_digraph(net)
    primary_seq = [s["id"] for s in primary["stations"]]
    chosen: list[dict] = []
    chosen_edges = [_edge_set(primary_seq)]
    seen = {tuple(primary_seq)}
    candidates: list[dict] = []

    _, fewest = run_algorithm(net, "dijkstra", origin, destination,
                              Objective("transfers", objective.transfer_penalty_s), max_transfers=max_transfers)
    if fewest:
        candidates.append(evaluate(net, objective, [s["id"] for s in fewest["stations"]], max_transfers=max_transfers))

    deadline = time.perf_counter() + time_budget_s
    try:
        gen = nx.shortest_simple_paths(g, origin, destination, weight="time")
        for path in itertools.islice(gen, 25 * k):
            if time.perf_counter() > deadline:
                break
            try:
                candidates.append(evaluate(net, objective, path, max_transfers=max_transfers))
            except ValueError:
                continue
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        pass

    def key(j):
        c = j["metrics"]["objective_cost"]
        return tuple(c) if isinstance(c, list) else (c if c is not None else float("inf"))

    for cand in sorted(candidates, key=key):
        seq = tuple(s["id"] for s in cand["stations"])
        if seq in seen or not cand["constraints_satisfied"]:
            continue
        es = _edge_set(list(seq))
        if any(len(es & other) / max(len(es | other), 1) > 0.8 for other in chosen_edges):
            continue
        seen.add(seq)
        chosen_edges.append(es)
        cand["tradeoff"] = describe_tradeoff(primary["metrics"], cand["metrics"])
        chosen.append(cand)
        if len(chosen) >= k:
            break
    return chosen


def describe_tradeoff(base: dict, alt: dict) -> str:
    parts = []
    dt = (alt["total_time_s"] - base["total_time_s"]) / 60
    if abs(dt) >= 0.5:
        parts.append(f"{'+' if dt > 0 else '−'}{abs(dt):.0f} min")
    dx = alt["transfers"] - base["transfers"]
    if dx:
        parts.append(f"{abs(dx)} {'more' if dx > 0 else 'fewer'} change{'s' if abs(dx) != 1 else ''}")
    ds = alt["stops"] - base["stops"]
    if ds:
        parts.append(f"{abs(ds)} {'more' if ds > 0 else 'fewer'} stop{'s' if abs(ds) != 1 else ''}")
    return ", ".join(parts) if parts else "Similar cost, different stations"


# ------------------------------------------------------------ schedule-aware
def _fmt_clock(seconds: int) -> str:
    day, rem = divmod(int(seconds), 86400)
    h, rem = divmod(rem, 3600)
    m, s = divmod(rem, 60)
    suffix = "" if day == 0 else f" ({'+' if day > 0 else ''}{day}d)"
    return f"{h:02d}:{m:02d}:{s:02d}{suffix}"


def fmt_wait(seconds: int) -> str:
    h, m = divmod(round(seconds / 60), 60)
    return f"{h} h {m} min" if h else f"{m} min"


def schedule_status(net: TransitNetwork, day: date) -> dict:
    in_range = bool(net.service_start and net.service_end and net.service_start <= day <= net.service_end)
    running = net.has_trips_on(day) if net.schedule_supported else False
    out = {"date": day.isoformat(), "in_validity_window": in_range, "has_service": running,
           "service_start": net.service_start.isoformat() if net.service_start else None,
           "service_end": net.service_end.isoformat() if net.service_end else None}
    if not running:
        alt = net.nearest_service_date(day)
        out["suggested_date"] = alt.isoformat() if alt else None
    return out


def plan_schedule(net: TransitNetwork, origin: str, destination: str, day: date, depart_s: int, *,
                  min_transfer_s: int, horizon_s: int = 24 * 3600, trace: Trace | None = None) -> dict:
    if not net.schedule_supported:
        raise RoutingError("schedule_unsupported", "This dataset has no usable timetable/calendar, so "
                           "schedule-aware routing is disabled.")
    status = schedule_status(net, day)
    # Trips of the previous service day timetabled past 24:00 still serve the early hours of this date.
    spillover = (net.has_overnight_service and depart_s <= net.overnight_until_s
                 and net.has_trips_on(day - timedelta(days=1)))
    if not status["has_service"] and not spillover:
        reason = ("outside the feed's validity window "
                  f"({status['service_start']} to {status['service_end']})" if not status["in_validity_window"]
                  else "a day with no scheduled trips in this feed")
        raise RoutingError("no_service_on_date", f"{day.isoformat()} is {reason}. The timetable cannot be "
                           "used for that date; no service is invented.", status)

    streams = []
    deps = net.connection_deps
    for offset in (-1, 0, 1):
        active = net.active_services(day + timedelta(days=offset))
        if not active:
            continue
        shift = offset * 86400
        lo = bisect.bisect_left(deps, depart_s - shift)
        hi = bisect.bisect_right(deps, depart_s + horizon_s - shift)
        streams.append(_ShiftedStream(net.connections[lo:hi], shift, active))
    merged = heapq.merge(*streams, key=lambda c: (c.dep, c.arr))
    res = connection_scan(merged, origin, destination, depart_s,
                          min_transfer_s=lambda st: net.min_transfer_at.get(st, min_transfer_s), trace=trace)
    if not res.found:
        trips_today = sum(net.service_trip_use.get(s, 0) for s in net.active_services(day))
        raise RoutingError("no_scheduled_journey", "No scheduled journey reaches the destination within "
                           f"{horizon_s // 3600} hours of the requested departure"
                           + (" (this day has very limited service in the feed)." if trips_today < 5000 else "."),
                           {"scanned": res.scanned, "suggested_date": status.get("suggested_date")})
    legs = []
    prev_arr = depart_s
    waiting = 0
    for leg in res.legs:
        info = net.routes[leg.route_id]
        line = net.lines[info.line_id]
        wait = leg.departures[0] - prev_arr
        waiting += wait
        legs.append({
            "trip_id": leg.trip_id, "route_id": leg.route_id, "route_short_name": info.short_name,
            "route_long_name": info.long_name, "line_id": line.id, "line_name": line.name, "color": line.color,
            "from_station": leg.stations[0], "to_station": leg.stations[-1], "stations": leg.stations,
            "hops": len(leg.stations) - 1, "departure": _fmt_clock(leg.departures[0]),
            "arrival": _fmt_clock(leg.arrivals[-1]), "departure_s": leg.departures[0], "arrival_s": leg.arrivals[-1],
            "wait_before_s": wait, "ride_time_s": leg.arrivals[-1] - leg.departures[0],
            "geometry": [[round(a, 6), round(b, 6)] for a, b in net.segment_geometry(leg.route_id, leg.stations)],
        })
        prev_arr = leg.arrivals[-1]
    path = [legs[0]["stations"][0]] + [s for leg in legs for s in leg["stations"][1:]] if legs else [origin]
    transfer_stations = {leg["from_station"] for leg in legs[1:]}
    in_vehicle = sum(leg["ride_time_s"] for leg in legs)
    warnings = []
    if legs and legs[0]["departure_s"] >= 86400:
        warnings.append(f"No connection leaves after {_fmt_clock(depart_s)} on {day.isoformat()}; the earliest "
                        f"journey departs the next day at {legs[0]['departure']}.")
    elif legs and legs[0]["wait_before_s"] >= 3600:
        wait = fmt_wait(legs[0]["wait_before_s"])
        warnings.append(f"The first suitable train leaves {wait} after the requested time.")
    return {
        "mode": "schedule",
        "warnings": warnings,
        "service_date": day.isoformat(),
        "requested_departure": _fmt_clock(depart_s),
        "stations": [{"id": s, "name": net.stations[s].name, "lat": net.stations[s].lat, "lon": net.stations[s].lon,
                      "role": "origin" if i == 0 else "destination" if i == len(path) - 1 else
                      "transfer" if s in transfer_stations else "pass"} for i, s in enumerate(path)],
        "legs": legs,
        "metrics": {
            "departure": legs[0]["departure"] if legs else _fmt_clock(depart_s),
            "arrival": _fmt_clock(res.arrival),
            "total_time_s": res.arrival - depart_s,
            "in_vehicle_s": in_vehicle,
            "waiting_s": waiting,
            "initial_wait_s": legs[0]["wait_before_s"] if legs else 0,
            "transfers": max(len(legs) - 1, 0),
            "stops": len(path) - 1,
            "min_transfer_s": min_transfer_s,
        },
        "search": {"algorithm": "csa", "algorithm_name": ALGORITHM_INFO["csa"]["name"],
                   "runtime_ms": round(res.runtime_ms, 3), "connections_scanned": res.scanned,
                   "arrival_improvements": res.improved,
                   **({"trace": {"events": trace.events, "truncated": trace.truncated,
                                 "max_events": trace.max_events}} if trace else {})},
    }


class _ShiftedStream:
    """Iterates connections of active services with times shifted to the query day."""

    __slots__ = ("conns", "shift", "active")

    def __init__(self, conns, shift, active):
        self.conns, self.shift, self.active = conns, shift, active

    def __iter__(self):
        shift, active = self.shift, self.active
        for c in self.conns:
            if c.service_id in active:
                yield c if shift == 0 else _Shifted(c, shift)


class _Shifted:
    __slots__ = ("dep_stop", "arr_stop", "dep", "arr", "trip_id", "route_id", "service_id")

    def __init__(self, c, shift):
        self.dep_stop, self.arr_stop = c.dep_stop, c.arr_stop
        self.dep, self.arr = c.dep + shift, c.arr + shift
        self.trip_id = f"{c.trip_id}@{shift // 86400:+d}d"
        self.route_id, self.service_id = c.route_id, c.service_id


def local_now(net: TransitNetwork) -> datetime:
    tz = ZoneInfo(net.timezone) if net.timezone else None
    return datetime.now(tz)


# ------------------------------------------------------------------- compare
def compare(net: TransitNetwork, origin: str, destination: str, objective: Objective, algorithms: list[str], *,
            repeats: int, max_transfers: int | None, timeout_s: float | None) -> dict:
    results = []
    for algo in algorithms:
        timings = []
        res = journey = None
        for _ in range(repeats):
            t0 = time.perf_counter()
            res, journey = run_algorithm(net, algo, origin, destination, objective, max_transfers=max_transfers,
                                         timeout_s=timeout_s)
            timings.append((time.perf_counter() - t0) * 1000)
        tracemalloc.start()
        run_algorithm(net, algo, origin, destination, objective, max_transfers=max_transfers, timeout_s=timeout_s)
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        results.append({
            "algorithm": algo, "algorithm_name": ALGORITHM_INFO[algo]["name"], "found": res.found,
            "journey": journey,
            "expanded": res.expanded, "generated": res.generated, "discovered": res.discovered,
            "max_frontier": res.max_frontier,
            "timing_ms": {"mean": statistics.fmean(timings), "median": statistics.median(timings),
                          "min": min(timings), "max": max(timings),
                          "stdev": statistics.stdev(timings) if len(timings) > 1 else 0.0, "runs": len(timings),
                          "samples": [round(t, 4) for t in timings[:repeats]]},
            "peak_python_alloc_kb": round(peak / 1024, 1),
            "expansion_order": res.expansion_order,
        })
    ref = next((r for r in results if r["algorithm"] == "dijkstra" and r["found"]), None)
    if ref is None and "dijkstra" not in algorithms:
        res, journey = run_algorithm(net, "dijkstra", origin, destination, objective, max_transfers=max_transfers,
                                     timeout_s=timeout_s)
        ref = {"journey": journey, "found": res.found}
    ref_cost = ref["journey"]["metrics"]["objective_cost"] if ref and ref["found"] else None
    for r in results:
        if not r["found"] or ref_cost is None:
            r["optimality"] = {"status": "unknown" if r["found"] else "no_route", "gap": None, "gap_pct": None}
            continue
        c = r["journey"]["metrics"]["objective_cost"]
        if isinstance(c, list):
            gap = [a - b for a, b in zip(c, ref_cost)]
            optimal = all(abs(x) < 1e-6 for x in gap)
            pct = None
        else:
            gap = c - ref_cost
            optimal = abs(gap) < 1e-6
            pct = (gap / ref_cost * 100) if ref_cost else 0.0
        r["optimality"] = {"status": "optimal" if optimal else "suboptimal", "gap": gap,
                           "gap_pct": None if pct is None else round(pct, 2),
                           "guaranteed": r["algorithm"] in ("dijkstra", "astar") or
                           (r["algorithm"] == "bfs" and objective.kind == "stops")}
    return {"objective": objective.kind, "objective_description": objective.describe(),
            "objective_unit": objective.unit, "reference": "dijkstra", "reference_cost": ref_cost,
            "repeats": repeats, "results": results}
