import random
import statistics

import networkx as nx
from fastapi import APIRouter, Depends, Query

from ..analytics import network_analytics
from ..config import Settings, get_settings
from ..graph.nx_export import station_digraph
from ..routing import planner as P
from ..routing.spaces import OBJECTIVES, Objective
from ..state import ActiveNetwork
from .common import active

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/network", summary="Topology metrics for the active network")
def network(act: ActiveNetwork = Depends(active)):
    key = "network_analytics"
    if key not in act.cache:
        act.cache[key] = network_analytics(act.network)
    return act.cache[key]


@router.get("/benchmark", summary="Algorithm benchmark over random origin/destination pairs")
def benchmark(pairs: int = Query(30, ge=5, le=200), seed: int = Query(42, ge=0, le=10_000),
              objective: str = Query("time", pattern="^(" + "|".join(OBJECTIVES) + ")$"),
              act: ActiveNetwork = Depends(active), settings: Settings = Depends(get_settings)):
    key = ("benchmark", pairs, seed, objective)
    if key in act.cache:
        return act.cache[key]
    net = act.network
    g = station_digraph(net)
    nodes = sorted(max(nx.strongly_connected_components(g), key=len)) if g.number_of_nodes() else []
    rng = random.Random(seed)
    od = []
    while len(nodes) > 1 and len(od) < pairs:
        a, b = rng.sample(nodes, 2)
        od.append((a, b))
    obj = Objective(objective, settings.default_transfer_penalty_s)
    rows = {a: {"expanded": [], "runtime_ms": [], "gap_pct": [], "optimal": 0, "found": 0}
            for a in P.ALGORITHMS}
    for a, b in od:
        ref = None
        per = {}
        for algo in ("dijkstra", "astar", "bfs", "gbfs"):
            res, journey = P.run_algorithm(net, algo, a, b, obj, timeout_s=settings.search_timeout_s)
            per[algo] = (res, journey)
            if algo == "dijkstra" and res.found:
                ref = journey["metrics"]["objective_cost"]
        for algo, (res, journey) in per.items():
            r = rows[algo]
            r["expanded"].append(res.expanded)
            r["runtime_ms"].append(res.runtime_ms)
            if res.found and ref is not None:
                r["found"] += 1
                c = journey["metrics"]["objective_cost"]
                if isinstance(c, list):
                    gap = 0.0 if c == ref else (100.0 if c[0] != ref[0] else (c[1] - ref[1]) / ref[1] * 100)
                else:
                    gap = (c - ref) / ref * 100 if ref else 0.0
                r["gap_pct"].append(gap)
                r["optimal"] += abs(gap) < 1e-9
    out = {"objective": objective, "objective_description": obj.describe(), "pairs": len(od), "seed": seed,
           "results": []}
    for algo, r in rows.items():
        out["results"].append({
            "algorithm": algo, "algorithm_name": P.ALGORITHM_INFO[algo]["name"],
            "mean_expanded": round(statistics.fmean(r["expanded"]), 1) if r["expanded"] else None,
            "median_runtime_ms": round(statistics.median(r["runtime_ms"]), 4) if r["runtime_ms"] else None,
            "mean_runtime_ms": round(statistics.fmean(r["runtime_ms"]), 4) if r["runtime_ms"] else None,
            "optimal_share": round(r["optimal"] / r["found"], 3) if r["found"] else None,
            "mean_gap_pct": round(statistics.fmean(r["gap_pct"]), 2) if r["gap_pct"] else None,
            "max_gap_pct": round(max(r["gap_pct"]), 2) if r["gap_pct"] else None,
        })
    out["note"] = ("Pairs are sampled from the largest strongly connected component with a fixed seed. Gaps are "
                   "relative to Dijkstra under the same objective; for the lexicographic transfers objective a "
                   "different number of changes counts as a 100% gap. Runtimes are wall-clock on this server.")
    bench_keys = [k for k in act.cache if isinstance(k, tuple) and k[0] == "benchmark"]
    for old in bench_keys[:max(0, len(bench_keys) - 15)]:  # keep the cache bounded
        act.cache.pop(old, None)
    act.cache[key] = out
    return out
