"""Connection Scan Algorithm (earliest arrival), for schedule-aware routing.

Input: elementary connections (one scheduled hop of one trip) sorted by departure time,
already filtered to the services running on the relevant service days and expressed
in seconds relative to the query day's midnight. The scan is a single pass, O(#connections).

Staying on the same trip needs no slack; changing to a different trip requires
``min_transfer_s(station)`` between arrival and the next departure.
"""

import math
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field

from .base import Trace


@dataclass
class CsaLeg:
    trip_id: str
    route_id: str
    stations: list[str]
    departures: list[int]
    arrivals: list[int]


@dataclass
class CsaResult:
    found: bool
    legs: list[CsaLeg] = field(default_factory=list)
    arrival: int | None = None
    scanned: int = 0
    improved: int = 0
    runtime_ms: float = 0.0
    trace: Trace | None = None


def connection_scan(connections: Iterable, origin: str, goal: str, depart: int, *,
                    min_transfer_s: Callable[[str], int], trace: Trace | None = None) -> CsaResult:
    t0 = time.perf_counter()
    earliest: dict[str, float] = {origin: depart}
    arrived_by: dict[str, str | None] = {origin: None}
    enter_conn: dict[str, object] = {}
    trip_conns: dict[str, list] = {}
    best_link: dict[str, tuple] = {}
    scanned = improved = 0

    for c in connections:
        if c.dep < depart:
            continue
        if earliest.get(goal, math.inf) <= c.dep:
            break  # nothing departing later can improve the arrival at the goal
        scanned += 1
        on_trip = c.trip_id in enter_conn
        if not on_trip:
            reach = earliest.get(c.dep_stop, math.inf)
            prev_trip = arrived_by.get(c.dep_stop)
            slack = 0 if (prev_trip is None or prev_trip == c.trip_id) else min_transfer_s(c.dep_stop)
            if reach + slack > c.dep:
                continue
            enter_conn[c.trip_id] = c
            trip_conns[c.trip_id] = []
            if trace:
                trace.record({"type": "board", "node": c.dep_stop, "trip": c.trip_id, "route": c.route_id,
                              "t": c.dep})
        trip_conns[c.trip_id].append(c)
        if c.arr < earliest.get(c.arr_stop, math.inf):
            earliest[c.arr_stop] = c.arr
            arrived_by[c.arr_stop] = c.trip_id
            best_link[c.arr_stop] = (c.trip_id, len(trip_conns[c.trip_id]))
            improved += 1
            if trace:
                trace.record({"type": "improve", "node": c.arr_stop, "from": c.dep_stop, "trip": c.trip_id,
                              "g": c.arr - depart, "t": c.arr})

    runtime = (time.perf_counter() - t0) * 1000
    if goal not in best_link and goal != origin:
        return CsaResult(False, scanned=scanned, improved=improved, runtime_ms=runtime, trace=trace)
    legs: list[CsaLeg] = []
    cur = goal
    guard = 0
    while cur != origin:
        guard += 1
        if guard > 10_000:
            raise RuntimeError("CSA journey reconstruction did not terminate.")
        trip_id, n = best_link[cur]
        conns = trip_conns[trip_id][:n]
        # The leg starts where the traveller boarded this trip.
        first = enter_conn[trip_id]
        start_idx = next(i for i, c in enumerate(conns) if c is first)
        leg_conns = conns[start_idx:]
        legs.append(CsaLeg(trip_id, leg_conns[0].route_id, [leg_conns[0].dep_stop] + [c.arr_stop for c in leg_conns],
                           [c.dep for c in leg_conns], [c.arr for c in leg_conns]))
        cur = leg_conns[0].dep_stop
    legs.reverse()
    if trace:
        trace.record({"type": "goal", "node": goal, "t": earliest.get(goal)})
    return CsaResult(True, legs, int(earliest.get(goal, depart)), scanned, improved, runtime, trace)
