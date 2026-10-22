"""Greedy Best-First Search - refactored from the original ``metro_path_search.py``.

The loop is the original one: a priority queue ordered by h(n) only, a ``came_from``
map that doubles as the "discovered" set, and a goal test when a node is popped.
What changed: the graph, coordinates and heuristic now come from a ``SearchSpace``
built from real GTFS data instead of hard-coded dictionaries, and every step is traced.

GBFS ignores the accumulated path cost g(n), so it is fast but the route it returns is
not guaranteed to be optimal under any objective.
"""

import heapq
from itertools import count

from .base import Deadline, SearchResult, SearchSpace, Trace, collapse_stations, reconstruct


def greedy_best_first_search(space: SearchSpace, origin: str, goal: str, *, trace: Trace | None = None,
                             timeout_s: float | None = None) -> SearchResult:
    clock = Deadline(timeout_s)
    tie = count()
    start = space.start(origin)
    h0 = space.geo_km(start, goal)
    frontier = [(h0, next(tie), start)]
    came_from = {start: None}
    expansion_order: list[str] = []
    seen_expanded: set[str] = set()
    expanded = generated = 0
    max_frontier = 1

    while frontier:
        clock.check()
        if trace:
            preview = trace.frontier(frontier, space)
        h, _, current = heapq.heappop(frontier)
        expanded += 1
        st = space.station(current)
        if st not in seen_expanded:
            seen_expanded.add(st)
            expansion_order.append(st)
        if trace:
            trace.record({"type": "expand", "node": st, "label": space.label(current), "h": round(h, 3),
                          "f": round(h, 3), "frontier_size": len(frontier) + 1, "frontier": preview})

        if space.is_goal(current, goal):
            states = reconstruct(came_from, current)
            if trace:
                trace.record({"type": "goal", "node": st, "label": space.label(current)})
            return SearchResult("gbfs", True, states, collapse_stations(space, states), None, expanded,
                                generated, len(came_from), expansion_order, clock.elapsed_ms(), trace, max_frontier)

        for neighbor, _cost in space.neighbors(current):
            if neighbor not in came_from:  # not yet discovered
                came_from[neighbor] = current
                h_n = space.geo_km(neighbor, goal)
                heapq.heappush(frontier, (h_n, next(tie), neighbor))
                generated += 1
                if trace:
                    trace.record({"type": "discover", "node": space.station(neighbor), "label": space.label(neighbor),
                                  "from": st, "h": round(h_n, 3)})
        max_frontier = max(max_frontier, len(frontier))

    return SearchResult("gbfs", False, [], [], None, expanded, generated, len(came_from), expansion_order,
                        clock.elapsed_ms(), trace, max_frontier)
