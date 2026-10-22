"""Network analytics computed from the active dataset's station graph.

Centrality measures describe the *topology* of the network (how many shortest paths pass
through a station); they are not measurements of passenger demand.
"""

import statistics
from collections import Counter

import networkx as nx

from .graph.network import TransitNetwork
from .graph.nx_export import station_digraph


def network_analytics(net: TransitNetwork, *, exact_limit: int = 1500) -> dict:
    dg = station_digraph(net)
    ug = dg.to_undirected()
    n = ug.number_of_nodes()

    comps = sorted(nx.connected_components(ug), key=len, reverse=True)
    weak_dir = nx.number_weakly_connected_components(dg)
    strong_dir = nx.number_strongly_connected_components(dg)

    degrees = dict(ug.degree())
    degree_dist = Counter(degrees.values())

    k = None if n <= exact_limit else min(300, n)
    betw = nx.betweenness_centrality(ug, k=k, normalized=True, seed=7)
    betw_time = nx.betweenness_centrality(dg, k=k, normalized=True, weight="time", seed=7)
    closeness = nx.closeness_centrality(dg, distance="time")

    def name(s):
        return net.stations[s].name

    top = sorted(betw, key=betw.get, reverse=True)[:15]
    interchanges = sorted((s for s in net.stations.values() if len(s.lines) > 1),
                          key=lambda s: (-len(s.lines), s.name))

    largest = ug.subgraph(comps[0]).copy() if comps else ug
    path_stats: dict = {"computed_on": "largest connected component", "nodes": largest.number_of_nodes()}
    if largest.number_of_nodes() <= exact_limit and largest.number_of_nodes() > 1:
        path_stats["avg_hops"] = round(nx.average_shortest_path_length(largest), 3)
        path_stats["diameter_hops"] = nx.diameter(largest)
        largest_dir = dg.subgraph(comps[0])
        if nx.is_strongly_connected(largest_dir):
            lengths = dict(nx.all_pairs_dijkstra_path_length(largest_dir, weight="time"))
            vals = [d for src in lengths.values() for t, d in src.items() if d > 0]
            path_stats["avg_time_min"] = round(statistics.fmean(vals) / 60, 2)
            path_stats["max_time_min"] = round(max(vals) / 60, 2)
            path_stats["time_basis"] = "scheduled ride time only (no transfer allowance)"
    else:
        path_stats["note"] = "Skipped: network too large for exact all-pairs computation."

    lines = []
    for line in sorted(net.lines.values(), key=lambda ln: ln.name):
        stations = {s for r in line.route_ids for s in net.routes[r].pattern}
        lines.append({"id": line.id, "name": line.name, "color": line.color, "color_source": line.color_source,
                      "routes": len(line.route_ids), "stations": len(stations),
                      "trips": sum(net.routes[r].trip_count for r in line.route_ids)})

    edge_times = [e.min_time for e in net.edges.values() if e.min_time]
    return {
        "summary": {
            "stations": len(net.stations), "routable_stations": len(net.routable), "routes": len(net.routes),
            "lines": len(net.lines), "directed_edges": dg.number_of_edges(), "track_segments": ug.number_of_edges(),
            "interchanges": len(interchanges), "connected_components": len(comps),
            "weakly_connected_directed": weak_dir, "strongly_connected_directed": strong_dir,
            "timetabled_connections": len(net.connections),
        },
        "components": [{"size": len(c), "sample": [name(s) for s in sorted(c)[:5]]} for c in comps[:10]],
        "degree_distribution": [{"degree": d, "stations": c} for d, c in sorted(degree_dist.items())],
        "top_betweenness": [{"id": s, "name": name(s), "betweenness": round(betw[s], 4),
                             "betweenness_time_weighted": round(betw_time.get(s, 0), 4),
                             "closeness_time": round(closeness.get(s, 0), 6), "degree": degrees[s],
                             "lines": sorted(net.stations[s].lines)} for s in top],
        "interchanges": [{"id": s.id, "name": s.name, "lines": sorted(s.lines), "degree": degrees.get(s.id, 0),
                          "betweenness": round(betw.get(s.id, 0), 4)} for s in interchanges],
        "lines": lines,
        "path_statistics": path_stats,
        "hop_time_distribution": _histogram(edge_times, 60),
        "betweenness_sampled": k is not None,
        "metric_notes": {
            "degree": "Number of distinct stations directly connected by track (either direction).",
            "betweenness": "Share of all shortest (fewest-hop) station-to-station paths passing through a station. "
                           "Topological importance, not ridership.",
            "betweenness_time_weighted": "Same, but shortest paths are measured in scheduled ride time.",
            "closeness_time": "Inverse of the average scheduled ride time from the station to all others.",
            "connected_components": "Groups of stations reachable from one another ignoring direction.",
        },
    }


def _histogram(values: list[float], bin_s: int) -> list[dict]:
    if not values:
        return []
    bins = Counter(int(v // bin_s) for v in values)
    return [{"from_min": b * bin_s / 60, "to_min": (b + 1) * bin_s / 60, "count": bins[b]}
            for b in range(min(bins), max(bins) + 1)]
