"""Algorithm tests on small controlled graphs, independent of GTFS."""

import itertools
import math
import random

import pytest

from app.algorithms.astar import a_star
from app.algorithms.base import Trace
from app.algorithms.bfs import breadth_first_search
from app.algorithms.dijkstra import NegativeWeightError, dijkstra
from app.algorithms.gbfs import greedy_best_first_search


class GraphSpace:
    """Plain weighted digraph with planar coordinates; h = euclidean * scale (admissible if
    every edge weight >= its euclidean length * scale)."""

    zero = 0.0

    def __init__(self, edges: dict[tuple[str, str], float], coords: dict[str, tuple[float, float]], scale=1.0):
        self.adj: dict[str, list[tuple[str, float]]] = {}
        for (u, v), w in edges.items():
            self.adj.setdefault(u, []).append((v, w))
        self.coords, self.scale = coords, scale

    def add(self, a, b):
        return a + b

    def start(self, o):
        return o

    def is_goal(self, s, g):
        return s == g

    def station(self, s):
        return s

    def label(self, s):
        return s

    def neighbors(self, s):
        return self.adj.get(s, [])

    def _d(self, a, b):
        (x1, y1), (x2, y2) = self.coords[a], self.coords[b]
        return math.hypot(x2 - x1, y2 - y1)

    def geo_km(self, s, g):
        return self._d(s, g)

    def heuristic(self, s, g):
        return self._d(s, g) * self.scale


def brute_force(space: GraphSpace, o: str, g: str):
    nodes = list(space.coords)
    best = math.inf
    for r in range(len(nodes)):
        for mid in itertools.permutations([n for n in nodes if n not in (o, g)], r):
            path = [o, *mid, g]
            total = 0.0
            for u, v in zip(path, path[1:]):
                w = dict(space.adj.get(u, [])).get(v)
                if w is None:
                    break
                total += w
            else:
                best = min(best, total)
    return best


def random_space(seed: int, n: int = 7, p: float = 0.45) -> GraphSpace:
    rng = random.Random(seed)
    coords = {f"n{i}": (rng.uniform(0, 10), rng.uniform(0, 10)) for i in range(n)}
    edges = {}
    for a, b in itertools.permutations(coords, 2):
        if rng.random() < p:
            (x1, y1), (x2, y2) = coords[a], coords[b]
            edges[(a, b)] = math.hypot(x2 - x1, y2 - y1) * rng.uniform(1.0, 2.5)  # >= straight line
    return GraphSpace(edges, coords)


@pytest.mark.parametrize("seed", range(25))
def test_dijkstra_and_astar_match_brute_force(seed):
    sp = random_space(seed)
    best = brute_force(sp, "n0", "n6")
    d = dijkstra(sp, "n0", "n6")
    a = a_star(sp, "n0", "n6")
    if math.isinf(best):
        assert not d.found and not a.found
    else:
        assert d.found and a.found
        assert d.cost == pytest.approx(best)
        assert a.cost == pytest.approx(best)  # admissible + consistent heuristic -> optimal
        assert a.expanded <= d.expanded + 1


def _diamond():
    #      B (near goal geographically but expensive)
    #    /   \
    #  A       D
    #    \   /
    #      C
    coords = {"A": (0, 0), "B": (5, 1), "C": (5, -4), "D": (10, 0)}
    edges = {("A", "B"): 5.1, ("B", "D"): 50.0, ("A", "C"): 6.5, ("C", "D"): 6.5}
    return GraphSpace(edges, coords)


def test_gbfs_follows_heuristic_and_can_be_suboptimal():
    sp = _diamond()
    g = greedy_best_first_search(sp, "A", "D")
    d = dijkstra(sp, "A", "D")
    assert g.found and g.stations == ["A", "B", "D"]
    assert d.stations == ["A", "C", "D"] and d.cost == pytest.approx(13.0)


def test_bfs_minimises_hops_not_cost():
    coords = {"A": (0, 0), "B": (1, 0), "C": (2, 0), "D": (3, 0)}
    edges = {("A", "D"): 100.0, ("A", "B"): 1, ("B", "C"): 1, ("C", "D"): 1}
    sp = GraphSpace(edges, coords)
    b = breadth_first_search(sp, "A", "D")
    d = dijkstra(sp, "A", "D")
    assert b.stations == ["A", "D"] and b.cost == 1
    assert d.stations == ["A", "B", "C", "D"] and d.cost == 3


@pytest.mark.parametrize("fn", [greedy_best_first_search, breadth_first_search, dijkstra, a_star])
def test_unreachable_destination(fn):
    sp = GraphSpace({("A", "B"): 1.0}, {"A": (0, 0), "B": (1, 0), "Z": (5, 5)})
    r = fn(sp, "A", "Z")
    assert not r.found and r.stations == [] and r.expanded >= 1


@pytest.mark.parametrize("fn", [greedy_best_first_search, breadth_first_search, dijkstra, a_star])
def test_origin_equals_destination(fn):
    sp = _diamond()
    r = fn(sp, "A", "A")
    assert r.found and r.stations == ["A"]


@pytest.mark.parametrize("fn", [dijkstra, a_star])
def test_negative_and_nan_weights_rejected(fn):
    sp = GraphSpace({("A", "B"): -1.0}, {"A": (0, 0), "B": (1, 0)})
    with pytest.raises(NegativeWeightError):
        fn(sp, "A", "B")
    sp = GraphSpace({("A", "B"): float("nan")}, {"A": (0, 0), "B": (1, 0)})
    with pytest.raises(NegativeWeightError):
        fn(sp, "A", "B")


@pytest.mark.parametrize("fn", [greedy_best_first_search, breadth_first_search, dijkstra, a_star])
def test_trace_consistency(fn):
    sp = random_space(3, n=8, p=0.5)
    tr = Trace(max_events=10_000, frontier_preview=4)
    r = fn(sp, "n0", "n7", trace=tr)
    expands = [e for e in tr.events if e["type"] == "expand"]
    assert len(expands) == r.expanded
    assert [e["i"] for e in tr.events] == list(range(len(tr.events)))
    if r.found:
        assert tr.events[-1]["type"] == "goal" and tr.events[-1]["node"] == "n7"
        # every expanded node (except the start) was discovered first
        discovered = {"n0"}
        for e in tr.events:
            if e["type"] in ("discover", "update"):
                discovered.add(e["node"])
            if e["type"] == "expand":
                assert e["node"] in discovered
    # untraced run takes the same decisions
    r2 = fn(sp, "n0", "n7")
    assert r2.stations == r.stations and r2.expanded == r.expanded


def test_trace_truncation_is_flagged_but_search_completes():
    sp = random_space(5, n=8, p=0.6)
    full = dijkstra(sp, "n0", "n7")
    tr = Trace(max_events=3, frontier_preview=2)
    r = dijkstra(sp, "n0", "n7", trace=tr)
    assert len(tr.events) == 3 and tr.truncated
    assert r.stations == full.stations


def test_lexicographic_costs_with_dijkstra():
    class Lex(GraphSpace):
        zero = (0, 0.0)

        def add(self, a, b):
            return tuple(x + y for x, y in zip(a, b))

        def heuristic(self, s, g):
            return (0, 0.0)

    coords = {"A": (0, 0), "B": (1, 0), "C": (2, 0)}
    sp = Lex({("A", "C"): (1, 10.0), ("A", "B"): (0, 30.0), ("B", "C"): (0, 30.0)}, coords)
    assert dijkstra(sp, "A", "C").stations == ["A", "B", "C"]  # fewer changes first, even though slower
    assert a_star(sp, "A", "C").cost == (0, 60.0)
