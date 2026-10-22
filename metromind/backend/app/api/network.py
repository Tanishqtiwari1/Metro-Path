from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query

from ..config import Settings, get_settings
from ..graph.geo import haversine_m
from ..routing.planner import ALGORITHM_INFO, local_now
from ..routing.spaces import OBJECTIVES, Objective
from ..schemas import NearbyStation, StationPage
from ..state import ActiveNetwork
from .common import active, dataset_out, freshness, station_summary

router = APIRouter(prefix="/api", tags=["network"])


@router.get("/meta", summary="Active dataset, capabilities and defaults")
def meta(act: ActiveNetwork = Depends(active), settings: Settings = Depends(get_settings)):
    net, ds = act.network, act.dataset
    now = local_now(net)
    edges_missing_distance = sum(1 for e in net.edges.values() if e.distance_m is None)
    objectives = []
    for kind in OBJECTIVES:
        ok, why = True, None
        if kind == "distance" and edges_missing_distance:
            ok, why = False, f"{edges_missing_distance} edges have neither track distance nor coordinates."
        objectives.append({"id": kind, "supported": ok, "reason": why,
                           "description": Objective(kind, settings.default_transfer_penalty_s).describe()})
    schedule_reason = None
    if not net.schedule_supported:
        schedule_reason = "The feed has no usable calendar or timed stop_times."
    return {
        "dataset": dataset_out(ds),
        "freshness": freshness(ds, now.date()),
        "attribution": ds.attribution,
        "timezone": net.timezone,
        "local_now": now.isoformat(timespec="minutes"),
        "bounds": net.bounds,
        "counts": {"stations": len(net.stations), "routes": len(net.routes), "lines": len(net.lines),
                   "edges": len(net.edges), "connections": len(net.connections)},
        "capabilities": {
            "objectives": objectives,
            "schedule": {"supported": net.schedule_supported, "reason": schedule_reason,
                         "service_start": net.service_start, "service_end": net.service_end,
                         "trip_hops_by_weekday": net.weekday_coverage},
            "transfer_data": net.has_transfer_data,
            "fares": False,
            "accessibility_data": any(s.wheelchair_boarding not in (None, 0) for s in net.stations.values()),
            "shapes": bool(net.shapes),
            "realtime": False,
        },
        "defaults": {"transfer_penalty_s": settings.default_transfer_penalty_s,
                     "min_transfer_s": settings.default_min_transfer_s, "max_alternatives": settings.max_alternatives,
                     "w_transfer_min": 5.0, "w_stop_min": 0.5, "benchmark_max_repeats": settings.benchmark_max_repeats},
        "algorithms": [{"id": k, **v} for k, v in ALGORITHM_INFO.items()],
        "network_notes": net.notes,
    }


@router.get("/stations", response_model=StationPage, summary="Search stations by name")
def stations(q: str = Query("", max_length=100), limit: int = Query(20, ge=1, le=500),
             offset: int = Query(0, ge=0), act: ActiveNetwork = Depends(active)):
    net = act.network
    matches = net.search_stations(q, limit=len(net.stations))
    return {"items": [station_summary(net, s) for s in matches[offset:offset + limit]], "total": len(matches),
            "limit": limit, "offset": offset}


@router.get("/stations/nearby", response_model=list[NearbyStation], summary="Stations within a radius")
def nearby(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180),
           radius_m: float = Query(1500, gt=0, le=50_000), limit: int = Query(10, ge=1, le=100),
           act: ActiveNetwork = Depends(active)):
    net = act.network
    out = []
    for s in net.stations.values():
        if s.has_coords:
            d = haversine_m(lat, lon, s.lat, s.lon)
            if d <= radius_m:
                out.append(station_summary(net, s) | {"distance_m": round(d, 1)})
    out.sort(key=lambda x: x["distance_m"])
    return out[:limit]


def _fmt(sec: int) -> str:
    d, r = divmod(sec, 86400)
    return f"{r // 3600:02d}:{r % 3600 // 60:02d}" + (" (+1d)" if d else "")


@router.get("/stations/{station_id}", summary="Station details")
def station_detail(station_id: str, act: ActiveNetwork = Depends(active)):
    net = act.network
    st = net.stations.get(station_id)
    if st is None:
        raise HTTPException(404, detail={"code": "unknown_station", "message": f"No station {station_id!r}."})
    neighbors = []
    for v in net.neighbors_of(st.id):
        out_e, in_e = net.edges.get((st.id, v)), net.edges.get((v, st.id))
        e = out_e or in_e
        neighbors.append({"id": v, "name": net.stations[v].name,
                          "outbound": out_e is not None, "inbound": in_e is not None,
                          "scheduled_time_s": e.min_time, "distance_m": e.distance_m,
                          "distance_source": e.distance_source,
                          "lines": sorted({net.routes[r].line_id for r in e.routes})})
    deps: dict[tuple[str, str], list[int]] = defaultdict(list)
    for c in net.connections:
        if c.dep_stop == st.id:
            deps[(c.route_id, c.service_id)].append(c.dep)
    service = []
    for (rid, sid), times in sorted(deps.items()):
        info = net.routes[rid]
        service.append({"route_id": rid, "route_long_name": info.long_name, "line_id": info.line_id,
                        "service_id": sid, "departures": len(times), "first": _fmt(min(times)),
                        "last": _fmt(max(times))})
    walk = [{"to": b, "to_name": net.stations[b].name, "min_transfer_time_s": t if t >= 0 else None}
            for b, t in net.walk_transfers.get(st.id, [])]
    return station_summary(net, st) | {
        "stop_ids": st.stop_ids,
        "routes": [{"id": r, "short_name": net.routes[r].short_name, "long_name": net.routes[r].long_name,
                    "line_id": net.routes[r].line_id} for r in sorted(st.routes)],
        "line_details": [{"id": ln, "name": net.lines[ln].name, "color": net.lines[ln].color}
                         for ln in sorted(st.lines)],
        "neighbors": neighbors,
        "scheduled_departures": service,
        "transfer_links": walk,
        "min_transfer_time_s": net.min_transfer_at.get(st.id),
        "wheelchair_boarding": st.wheelchair_boarding if st.wheelchair_boarding not in (None, 0) else None,
        "accessibility_note": None if st.wheelchair_boarding not in (None, 0) else
        "The dataset has no accessibility information for this station.",
    }


@router.get("/network/map", summary="Stations, line geometry and legend for the map")
def network_map(act: ActiveNetwork = Depends(active)):
    net = act.network
    routes = []
    for rid, info in sorted(net.routes.items()):
        if not info.pattern:
            continue
        geom, src = net.route_geometry(rid)
        line = net.lines[info.line_id]
        routes.append({"route_id": rid, "line_id": line.id, "color": line.color, "short_name": info.short_name,
                       "long_name": info.long_name, "geometry_source": src, "trips": info.trip_count,
                       "geometry": [[round(a, 6), round(b, 6)] for a, b in geom]})
    return {
        "stations": [station_summary(net, s) for s in sorted(net.stations.values(), key=lambda s: s.name)],
        "routes": routes,
        "lines": [{"id": ln.id, "name": ln.name, "color": ln.color, "color_source": ln.color_source,
                   "routes": ln.route_ids} for ln in sorted(net.lines.values(), key=lambda ln: ln.name)],
        "bounds": net.bounds,
    }


@router.get("/algorithms", summary="Implemented algorithms")
def algorithms():
    return [{"id": k, **v} for k, v in ALGORITHM_INFO.items()]
