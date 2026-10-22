"""Dijkstra's algorithm: minimum-cost path for non-negative edge weights.

Uses a binary heap with lazy deletion. Costs may be scalars or tuples (lexicographic
objectives such as "fewest transfers, then fastest"); tuple addition is component-wise
and Python's tuple ordering is lexicographic, which preserves Dijkstra's correctness
as long as every component is non-negative.
"""

import heapq
from itertools import count

from .base import Deadline, SearchResult, SearchSpace, Trace, as_json_cost, collapse_stations, reconstruct


class NegativeWeightError(ValueError):
    pass


def is_negative(c) -> bool:
    if isinstance(c, tuple):
        return any(x < 0 for x in c)
    return c < 0 or c != c  # NaN is never a valid weight


def dijkstra(space: SearchSpace, origin: str, goal: str, *, trace: Trace | None = None,
             timeout_s: float | None = None) -> SearchResult:
    clock = Deadline(timeout_s)
    tie = count()
    start = space.start(origin)
    g = {start: space.zero}
    came_from = {start: None}
    frontier = [(space.zero, next(tie), start)]
    closed: set = set()
    expansion_order: list[str] = []
    seen_expanded: set[str] = set()
    expanded = generated = 0
    max_frontier = 1

    while frontier:
        clock.check()
        if trace:
            preview = trace.frontier(frontier, space)
        cost, _, current = heapq.heappop(frontier)
        if current in closed:
            continue  # stale heap entry
        closed.add(current)
        expanded += 1
        st = space.station(current)
        if st not in seen_expanded:
            seen_expanded.add(st)
            expansion_order.append(st)
        if trace:
            trace.record({"type": "expand", "node": st, "label": space.label(current), "g": as_json_cost(cost),
                          "f": as_json_cost(cost), "frontier_size": len(frontier) + 1, "frontier": preview})
        if space.is_goal(current, goal):
            states = reconstruct(came_from, current)
            if trace:
                trace.record({"type": "goal", "node": st, "label": space.label(current), "g": as_json_cost(cost)})
            return SearchResult("dijkstra", True, states, collapse_stations(space, states), cost, expanded,
                                generated, len(g), expansion_order, clock.elapsed_ms(), trace, max_frontier)
        for neighbor, w in space.neighbors(current):
            if is_negative(w):
                raise NegativeWeightError(f"Negative or invalid edge weight {w!r} at {st}.")
            if neighbor in closed:
                continue
            new_cost = space.add(cost, w)
            old = g.get(neighbor)
            if old is None or new_cost < old:
                g[neighbor] = new_cost
                came_from[neighbor] = current
                heapq.heappush(frontier, (new_cost, next(tie), neighbor))
                generated += 1
                if trace:
                    trace.record({"type": "discover" if old is None else "update", "node": space.station(neighbor),
                                  "label": space.label(neighbor), "from": st, "g": as_json_cost(new_cost)})
        max_frontier = max(max_frontier, len(frontier))

    return SearchResult("dijkstra", False, [], [], None, expanded, generated, len(g), expansion_order,
                        clock.elapsed_ms(), trace, max_frontier)
