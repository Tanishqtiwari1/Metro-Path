"""Shared search infrastructure: the state-space interface, execution traces and results.

The algorithms only see a ``SearchSpace``; they know nothing about GTFS. This keeps
each algorithm independently testable on tiny synthetic graphs.
"""

import heapq
import time
from collections.abc import Hashable, Iterable
from dataclasses import dataclass, field
from typing import Any, Protocol

Cost = Any  # float, or a tuple for lexicographic objectives


class SearchTimeout(RuntimeError):
    pass


class SearchSpace(Protocol):
    def start(self, origin: str) -> Hashable: ...
    def is_goal(self, state: Hashable, goal: str) -> bool: ...
    def neighbors(self, state: Hashable) -> Iterable[tuple[Hashable, Cost]]: ...
    def station(self, state: Hashable) -> str: ...
    def label(self, state: Hashable) -> str: ...
    def heuristic(self, state: Hashable, goal: str) -> Cost: ...
    def geo_km(self, state: Hashable, goal: str) -> float: ...
    zero: Cost
    def add(self, a: Cost, b: Cost) -> Cost: ...


def as_json_cost(c: Cost):
    if isinstance(c, tuple):
        return [round(x, 3) for x in c]
    return None if c is None else round(float(c), 3)


@dataclass
class Trace:
    """Bounded record of a real execution. Recording stops at ``max_events`` (flagged),
    the search itself always runs to completion."""

    max_events: int
    frontier_preview: int
    events: list[dict] = field(default_factory=list)
    truncated: bool = False
    enabled: bool = True

    def record(self, event: dict) -> None:
        if not self.enabled:
            return
        if len(self.events) >= self.max_events:
            self.truncated = True
            return
        event["i"] = len(self.events)
        self.events.append(event)

    def frontier(self, heap: list, space: SearchSpace, key_index: int = 0, state_index: int = -1) -> list | None:
        if not self.enabled or len(self.events) >= self.max_events:
            return None
        top = heapq.nsmallest(self.frontier_preview, heap)
        return [{"node": space.station(e[state_index]), "label": space.label(e[state_index]),
                 "priority": as_json_cost(e[key_index])} for e in top]


@dataclass
class SearchResult:
    algorithm: str
    found: bool
    states: list[Hashable]
    stations: list[str]
    cost: Cost | None
    expanded: int  # states removed from the frontier and expanded
    generated: int  # successor states pushed onto the frontier (incl. duplicates)
    discovered: int  # distinct states ever seen
    expansion_order: list[str]  # stations in the order they were first expanded
    runtime_ms: float
    trace: Trace | None
    max_frontier: int = 0


def reconstruct(came_from: dict, goal_state: Hashable) -> list[Hashable]:
    path = []
    cur = goal_state
    while cur is not None:
        path.append(cur)
        cur = came_from[cur]
    return path[::-1]


def collapse_stations(space: SearchSpace, states: list[Hashable]) -> list[str]:
    out: list[str] = []
    for s in states:
        st = space.station(s)
        if not out or out[-1] != st:
            out.append(st)
    return out


class Deadline:
    def __init__(self, seconds: float | None):
        self.t0 = time.perf_counter()
        self.limit = None if seconds is None else self.t0 + seconds
        self.n = 0

    def check(self) -> None:
        self.n += 1
        if self.limit is not None and self.n % 512 == 0 and time.perf_counter() > self.limit:
            raise SearchTimeout("Search exceeded its time limit.")

    def elapsed_ms(self) -> float:
        return (time.perf_counter() - self.t0) * 1000
