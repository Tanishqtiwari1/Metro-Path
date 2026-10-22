import networkx as nx

from .network import TransitNetwork


def station_digraph(net: TransitNetwork) -> nx.DiGraph:
    g = nx.DiGraph()
    for s in net.stations.values():
        if s.id in net.routable:
            g.add_node(s.id, name=s.name)
    for (u, v), e in net.edges.items():
        g.add_edge(u, v, time=e.min_time if e.min_time is not None else 0.0,
                   distance=e.distance_m, hops=1)
    return g
