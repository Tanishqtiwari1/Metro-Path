"""Search spaces and objectives over a ``TransitNetwork``.

Objectives are explicit and never mix incompatible units silently:

* ``time``      - seconds: scheduled ride time + a transfer allowance per train change.
* ``transfers`` - lexicographic (train changes, seconds): fewest changes, then fastest.
* ``distance``  - metres of track (shape_dist_traveled, else a labelled straight-line estimate).
* ``stops``     - number of station-to-station hops.
* ``balanced``  - "generalised minutes": minutes + w_transfer per change + w_stop per hop.
                  The weights are user-configurable and stated in every result.
"""

from dataclasses import dataclass
from typing import Literal

from ..graph.network import TransitNetwork

ObjectiveKind = Literal["time", "transfers", "distance", "stops", "balanced"]
OBJECTIVES: tuple[str, ...] = ("time", "transfers", "distance", "stops", "balanced")


@dataclass(frozen=True)
class Objective:
    kind: ObjectiveKind = "time"
    transfer_penalty_s: int = 300
    w_transfer_min: float = 5.0
    w_stop_min: float = 0.5

    @property
    def route_aware(self) -> bool:
        return self.kind in ("time", "transfers", "balanced")

    @property
    def unit(self) -> str:
        return {"time": "seconds", "transfers": "(changes, seconds)", "distance": "metres", "stops": "hops",
                "balanced": "generalised minutes"}[self.kind]

    def describe(self) -> str:
        p = self.transfer_penalty_s
        return {
            "time": f"Minimise scheduled travel time; each train change adds an assumed {p}s transfer allowance.",
            "transfers": "Minimise train changes first, then scheduled travel time (lexicographic).",
            "distance": "Minimise track distance (metres).",
            "stops": "Minimise the number of station-to-station hops.",
            "balanced": (f"Minimise minutes + {self.w_transfer_min:g} min per train change + "
                         f"{self.w_stop_min:g} min per stop (configurable weights; transfer allowance {p}s)."),
        }[self.kind]

    # Cost of riding one scheduled hop of ``seconds``.
    def ride(self, seconds: float):
        if self.kind == "time":
            return seconds
        if self.kind == "transfers":
            return (0, seconds)
        if self.kind == "balanced":
            return seconds / 60 + self.w_stop_min
        raise ValueError(self.kind)

    def change(self, seconds: float):
        if self.kind == "time":
            return float(seconds)
        if self.kind == "transfers":
            return (1, float(seconds))
        if self.kind == "balanced":
            return seconds / 60 + self.w_transfer_min
        raise ValueError(self.kind)

    @property
    def zero(self):
        return (0, 0.0) if self.kind == "transfers" else 0.0


def _add(a, b):
    if isinstance(a, tuple):
        return tuple(x + y for x, y in zip(a, b))
    return a + b


class StationSpace:
    """States are station ids. Used by BFS/GBFS for every objective, and by Dijkstra/A* for
    the distance and stops objectives."""

    def __init__(self, net: TransitNetwork, objective: Objective):
        self.net = net
        self.objective = objective
        self.zero = 0.0

    def add(self, a, b):
        return a + b

    def start(self, origin):
        return origin

    def is_goal(self, state, goal):
        return state == goal

    def station(self, state):
        return state

    def label(self, state):
        st = self.net.stations.get(state)
        return st.name if st else str(state)

    def neighbors(self, state):
        net, kind = self.net, self.objective.kind
        for v in net.adj.get(state, ()):
            e = net.edges[(state, v)]
            if kind == "distance":
                if e.distance_m is None:
                    continue
                yield v, e.distance_m
            elif kind == "stops":
                yield v, 1.0
            else:  # cost-agnostic searches (BFS/GBFS) still get a meaningful number
                yield v, e.min_time if e.min_time is not None else 1.0

    def geo_km(self, state, goal):
        d = self.net.straight_m(state, goal)
        return 0.0 if d is None else d / 1000

    def heuristic(self, state, goal):
        d = self.net.straight_m(state, goal)
        if d is None:
            return 0.0
        if self.objective.kind == "distance":
            return self.net.min_dist_ratio * d
        if self.objective.kind == "stops":
            return d / self.net.max_edge_straight_m if self.net.max_edge_straight_m else 0.0
        return self.net.min_s_per_m * d


class RouteSpace:
    """Route-aware states: (station, route_id, k) while riding, (station, None, k) while at a
    station between trains. Changing trains = alighting (transfer cost) then boarding.
    ``k`` counts train changes and is only tracked when a transfer limit is set (otherwise 0),
    so the limit is enforced exactly rather than by post-filtering."""

    def __init__(self, net: TransitNetwork, objective: Objective, *, max_transfers: int | None = None,
                 avoid_routes: frozenset[str] = frozenset()):
        self.net = net
        self.objective = objective
        self.zero = objective.zero
        self.max_transfers = max_transfers
        self.avoid_routes = avoid_routes

    def add(self, a, b):
        return _add(a, b)

    def start(self, origin):
        return (origin, None, 0)

    def is_goal(self, state, goal):
        return state[0] == goal

    def station(self, state):
        return state[0]

    def label(self, state):
        st = self.net.stations.get(state[0])
        name = st.name if st else str(state[0])
        if state[1] is None:
            return f"{name} (at station)"
        r = self.net.routes[state[1]]
        return f"{name} on {self.net.lines[r.line_id].name} ({r.short_name or r.id})"

    def _transfer_s(self, station: str) -> float:
        return float(self.net.min_transfer_at.get(station, self.objective.transfer_penalty_s))

    def neighbors(self, state):
        s, route, k = state
        net, obj = self.net, self.objective
        if route is not None:
            for v in net.adj.get(s, ()):
                t = net.edges[(s, v)].route_times.get(route)
                if t is not None:
                    yield (v, route, k), obj.ride(t)
            if self.max_transfers is None:
                yield (s, None, 0), obj.change(self._transfer_s(s))
            elif k < self.max_transfers:
                yield (s, None, k + 1), obj.change(self._transfer_s(s))
            return
        for v in net.adj.get(s, ()):
            for r, t in net.edges[(s, v)].route_times.items():
                if r not in self.avoid_routes:
                    yield (v, r, k), obj.ride(t)

    def geo_km(self, state, goal):
        d = self.net.straight_m(state[0], goal)
        return 0.0 if d is None else d / 1000

    def heuristic(self, state, goal):
        d = self.net.straight_m(state[0], goal)
        if d is None:
            return self.zero
        secs = self.net.min_s_per_m * d
        if self.objective.kind == "time":
            return secs
        if self.objective.kind == "transfers":
            return (0, secs)
        hops = d / self.net.max_edge_straight_m if self.net.max_edge_straight_m else 0.0
        return secs / 60 + self.objective.w_stop_min * hops


def space_for(net: TransitNetwork, objective: Objective, algorithm: str, *, max_transfers: int | None = None):
    """BFS and GBFS ignore edge costs by definition, so they search the station graph; their
    paths are then costed under the selected objective by the route evaluator."""
    if algorithm in ("bfs", "gbfs") or not objective.route_aware:
        return StationSpace(net, objective)
    return RouteSpace(net, objective, max_transfers=max_transfers)
