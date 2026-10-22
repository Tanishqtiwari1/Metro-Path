"""Turn a station sequence (or a route-aware state path) into a costed journey.

Every algorithm's output is costed here with the same rules, so results from different
algorithms are directly comparable under one stated objective.
"""

from dataclasses import dataclass

from ..graph.network import TransitNetwork
from .spaces import Objective


class InvalidPath(ValueError):
    pass


@dataclass
class Ride:
    route_id: str
    stations: list[str]
    times: list[float]
    distances: list[float | None]
    distance_sources: list[str]


def _assign_routes(net: TransitNetwork, path: list[str], objective: Objective) -> list[Ride]:
    """Choose a route for every hop of a fixed station path, minimising the objective's
    ride/change costs (dynamic programming over hops x routes)."""
    if len(path) < 2:
        return []
    dp_obj = objective if objective.route_aware else Objective("transfers", objective.transfer_penalty_s)
    options = []
    for u, v in zip(path, path[1:]):
        e = net.edges.get((u, v))
        if e is None or not e.route_times:
            raise InvalidPath(f"No scheduled service from {u} to {v}.")
        options.append(e.route_times)

    def add(a, b):
        return tuple(x + y for x, y in zip(a, b)) if isinstance(a, tuple) else a + b

    prev = {r: (dp_obj.ride(t), None) for r, t in options[0].items()}
    back = [prev]
    for i in range(1, len(options)):
        cur = {}
        change = dp_obj.change(float(net.min_transfer_at.get(path[i], objective.transfer_penalty_s)))
        best_prev_r = min(prev, key=lambda r: prev[r][0])
        for r, t in options[i].items():
            cands = []
            if r in prev:
                cands.append((add(prev[r][0], dp_obj.ride(t)), r))
            cands.append((add(add(prev[best_prev_r][0], change), dp_obj.ride(t)), best_prev_r))
            cur[r] = min(cands, key=lambda c: c[0])
        back.append(cur)
        prev = cur
    r = min(prev, key=lambda k: prev[k][0])
    chosen = [r]
    for i in range(len(options) - 1, 0, -1):
        r = back[i][r][1]
        chosen.append(r)
    chosen.reverse()
    return _rides_from_hops(net, path, chosen)


def _rides_from_hops(net: TransitNetwork, path: list[str], hop_routes: list[str]) -> list[Ride]:
    rides: list[Ride] = []
    for i, r in enumerate(hop_routes):
        u, v = path[i], path[i + 1]
        e = net.edges[(u, v)]
        if not rides or rides[-1].route_id != r:
            rides.append(Ride(r, [u], [], [], []))
        ride = rides[-1]
        ride.stations.append(v)
        ride.times.append(e.route_times[r])
        ride.distances.append(e.distance_m)
        ride.distance_sources.append(e.distance_source)
    return rides


def _rides_from_states(net: TransitNetwork, states: list) -> tuple[list[str], list[Ride]]:
    path: list[str] = [states[0][0]]
    hop_routes: list[str] = []
    for a, b in zip(states, states[1:]):
        if b[1] is not None and b[0] != a[0]:
            path.append(b[0])
            hop_routes.append(b[1])
        elif b[0] != a[0]:
            raise InvalidPath("State path moves between stations without a ride.")
    # Two consecutive rides on the same route separated by an alight/board are distinct rides.
    rides: list[Ride] = []
    hop = 0
    prev_route = None
    for a, b in zip(states, states[1:]):
        if b[1] is None:
            prev_route = None
            continue
        if b[0] == a[0]:
            continue
        u, v, r = path[hop], path[hop + 1], hop_routes[hop]
        e = net.edges[(u, v)]
        if prev_route != r or not rides:
            rides.append(Ride(r, [u], [], [], []))
        rides[-1].stations.append(v)
        rides[-1].times.append(e.route_times[r])
        rides[-1].distances.append(e.distance_m)
        rides[-1].distance_sources.append(e.distance_source)
        prev_route = r
        hop += 1
    return path, rides


def evaluate(net: TransitNetwork, objective: Objective, stations: list[str], states: list | None = None,
             *, max_transfers: int | None = None) -> dict:
    if not stations:
        raise InvalidPath("Empty path.")
    for s in stations:
        if s not in net.stations:
            raise InvalidPath(f"Unknown station {s}.")
    if states and isinstance(states[0], tuple):
        path, rides = _rides_from_states(net, states)
    else:
        path = stations
        rides = _assign_routes(net, path, objective)

    transfers = max(len(rides) - 1, 0)
    line_seq = [net.routes[r.route_id].line_id for r in rides]
    line_changes = sum(1 for a, b in zip(line_seq, line_seq[1:]) if a != b)
    in_vehicle = sum(sum(r.times) for r in rides)
    allowances = []
    for r in rides[1:]:
        st = r.stations[0]
        src = "transfers.txt" if st in net.min_transfer_at else "assumed"
        allowances.append({"station": st, "seconds": float(net.min_transfer_at.get(st, objective.transfer_penalty_s)),
                           "source": src})
    transfer_s = sum(a["seconds"] for a in allowances)
    hops = len(path) - 1
    dists = [d for r in rides for d in r.distances]
    sources = {s for r in rides for s in r.distance_sources}
    distance_m = sum(d for d in dists if d is not None) if dists and all(d is not None for d in dists) else None
    total_s = in_vehicle + transfer_s

    k = objective.kind
    if k == "time":
        cost = total_s
    elif k == "transfers":
        cost = [transfers, round(total_s, 3)]
    elif k == "distance":
        cost = distance_m
    elif k == "stops":
        cost = hops
    else:
        cost = total_s / 60 + objective.w_transfer_min * transfers + objective.w_stop_min * hops

    ride_out = []
    for r in rides:
        info = net.routes[r.route_id]
        line = net.lines[info.line_id]
        ride_out.append({
            "route_id": r.route_id, "route_short_name": info.short_name, "route_long_name": info.long_name,
            "line_id": line.id, "line_name": line.name, "color": line.color,
            "from_station": r.stations[0], "to_station": r.stations[-1], "stations": r.stations,
            "hops": len(r.stations) - 1, "ride_time_s": round(sum(r.times), 1),
            "distance_m": round(sum(r.distances), 1) if all(d is not None for d in r.distances) else None,
            "geometry": [[round(a, 6), round(b, 6)] for a, b in net.segment_geometry(r.route_id, r.stations)],
        })

    transfer_stations = {r.stations[0] for r in rides[1:]}
    return {
        "stations": [{"id": s, "name": net.stations[s].name, "lat": net.stations[s].lat, "lon": net.stations[s].lon,
                      "role": "origin" if i == 0 else "destination" if i == len(path) - 1 else
                      "transfer" if s in transfer_stations else "pass"} for i, s in enumerate(path)],
        "rides": ride_out,
        "transfers_detail": allowances,
        "metrics": {
            "stops": hops,
            "stations_visited": len(path),
            "transfers": transfers,
            "line_changes": line_changes,
            "in_vehicle_s": round(in_vehicle, 1),
            "transfer_allowance_s": round(transfer_s, 1),
            "total_time_s": round(total_s, 1),
            "distance_m": None if distance_m is None else round(distance_m, 1),
            "distance_basis": sorted(sources),
            "objective": k,
            "objective_cost": cost if not isinstance(cost, float) else round(cost, 3),
            "objective_unit": objective.unit,
        },
        "constraints_satisfied": max_transfers is None or transfers <= max_transfers,
    }
