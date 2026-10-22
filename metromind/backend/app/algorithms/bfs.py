"""Breadth-First Search: fewest edges (hops) in an unweighted graph.

Minimum hops is *not* minimum travel time: a two-stop hop across a long tunnel can take
longer than three short hops. Edge costs supplied by the space are ignored.
"""

from collections import deque

from .base import Deadline, SearchResult, SearchSpace, Trace, collapse_stations, reconstruct


def breadth_first_search(space: SearchSpace, origin: str, goal: str, *, trace: Trace | None = None,
                         timeout_s: float | None = None) -> SearchResult:
    clock = Deadline(timeout_s)
    start = space.start(origin)
    came_from = {start: None}
    depth = {start: 0}
    queue = deque([start])
    expansion_order: list[str] = []
    seen_expanded: set[str] = set()
    expanded = generated = 0
    max_frontier = 1

    if space.is_goal(start, goal):
        if trace:
            trace.record({"type": "goal", "node": space.station(start), "label": space.label(start)})
        return SearchResult("bfs", True, [start], [space.station(start)], 0, 0, 0, 1, [], clock.elapsed_ms(),
                            trace, 1)

    while queue:
        clock.check()
        current = queue.popleft()
        expanded += 1
        st = space.station(current)
        if st not in seen_expanded:
            seen_expanded.add(st)
            expansion_order.append(st)
        if trace:
            preview = [{"node": space.station(s), "label": space.label(s), "priority": depth[s]}
                       for s in list(queue)[:trace.frontier_preview]]
            trace.record({"type": "expand", "node": st, "label": space.label(current), "g": depth[current],
                          "f": depth[current], "frontier_size": len(queue) + 1, "frontier": preview})
        for neighbor, _cost in space.neighbors(current):
            if neighbor in came_from:
                continue
            came_from[neighbor] = current
            depth[neighbor] = depth[current] + 1
            generated += 1
            if trace:
                trace.record({"type": "discover", "node": space.station(neighbor), "label": space.label(neighbor),
                              "from": st, "g": depth[neighbor]})
            # Goal test on generation is safe for BFS: the first time the goal is seen is at minimum depth.
            if space.is_goal(neighbor, goal):
                states = reconstruct(came_from, neighbor)
                if trace:
                    trace.record({"type": "goal", "node": space.station(neighbor), "label": space.label(neighbor)})
                return SearchResult("bfs", True, states, collapse_stations(space, states), depth[neighbor],
                                    expanded, generated, len(came_from), expansion_order, clock.elapsed_ms(),
                                    trace, max(max_frontier, len(queue)))
            queue.append(neighbor)
        max_frontier = max(max_frontier, len(queue))

    return SearchResult("bfs", False, [], [], None, expanded, generated, len(came_from), expansion_order,
                        clock.elapsed_ms(), trace, max_frontier)
