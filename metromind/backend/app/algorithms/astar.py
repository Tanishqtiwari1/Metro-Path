"""A* search: f(n) = g(n) + h(n).

Returns an optimal path when h is admissible (never overestimates the remaining cost)
and, with this closed-set implementation, consistent (h(u) <= w(u,v) + h(v)). The
transit spaces provide h = c * straight_line_distance where c is the minimum cost per
straight-line metre over every edge in the network, which satisfies both conditions
in the objective's own units (seconds, metres, ...). Ties on f are broken towards the
larger g (deeper node) to reduce expansions.
"""

import heapq
from itertools import count

from .base import Deadline, SearchResult, SearchSpace, Trace, as_json_cost, collapse_stations, reconstruct
from .dijkstra import NegativeWeightError, is_negative


def _neg(c):
    return tuple(-x for x in c) if isinstance(c, tuple) else -c


def a_star(space: SearchSpace, origin: str, goal: str, *, trace: Trace | None = None,
           timeout_s: float | None = None) -> SearchResult:
    clock = Deadline(timeout_s)
    tie = count()
    start = space.start(origin)
    g = {start: space.zero}
    came_from = {start: None}
    h0 = space.heuristic(start, goal)
    frontier = [(space.add(space.zero, h0), _neg(space.zero), next(tie), start)]
    closed: set = set()
    expansion_order: list[str] = []
    seen_expanded: set[str] = set()
    expanded = generated = 0
    max_frontier = 1

    while frontier:
        clock.check()
        if trace:
            preview = trace.frontier(frontier, space)
        f, _, _, current = heapq.heappop(frontier)
        if current in closed:
            continue
        closed.add(current)
        expanded += 1
        st = space.station(current)
        if st not in seen_expanded:
            seen_expanded.add(st)
            expansion_order.append(st)
        gc = g[current]
        if trace:
            trace.record({"type": "expand", "node": st, "label": space.label(current), "g": as_json_cost(gc),
                          "h": as_json_cost(space.heuristic(current, goal)), "f": as_json_cost(f),
                          "frontier_size": len(frontier) + 1, "frontier": preview})
        if space.is_goal(current, goal):
            states = reconstruct(came_from, current)
            if trace:
                trace.record({"type": "goal", "node": st, "label": space.label(current), "g": as_json_cost(gc)})
            return SearchResult("astar", True, states, collapse_stations(space, states), gc, expanded, generated,
                                len(g), expansion_order, clock.elapsed_ms(), trace, max_frontier)
        for neighbor, w in space.neighbors(current):
            if is_negative(w):
                raise NegativeWeightError(f"Negative or invalid edge weight {w!r} at {st}.")
            if neighbor in closed:
                continue
            new_g = space.add(gc, w)
            old = g.get(neighbor)
            if old is None or new_g < old:
                g[neighbor] = new_g
                came_from[neighbor] = current
                h = space.heuristic(neighbor, goal)
                nf = space.add(new_g, h)
                heapq.heappush(frontier, (nf, _neg(new_g), next(tie), neighbor))
                generated += 1
                if trace:
                    trace.record({"type": "discover" if old is None else "update", "node": space.station(neighbor),
                                  "label": space.label(neighbor), "from": st, "g": as_json_cost(new_g),
                                  "h": as_json_cost(h), "f": as_json_cost(nf)})
        max_frontier = max(max_frontier, len(frontier))

    return SearchResult("astar", False, [], [], None, expanded, generated, len(g), expansion_order,
                        clock.elapsed_ms(), trace, max_frontier)
