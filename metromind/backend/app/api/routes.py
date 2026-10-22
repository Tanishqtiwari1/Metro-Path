import csv
import io
import json
from datetime import datetime

import networkx as nx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..algorithms.base import SearchTimeout
from ..algorithms.dijkstra import NegativeWeightError
from ..config import Settings, get_settings
from ..db import get_session
from ..graph.network import TransitNetwork
from ..graph.nx_export import station_digraph
from ..models import SavedRoute
from ..routing import planner as P
from ..routing.evaluate import evaluate
from ..routing.spaces import Objective
from ..schemas import CompareRequest, ExportRequest, PlanRequest, RoutingPrefs, RunRequest
from ..security import optional_client_id
from ..state import ActiveNetwork
from .common import active, aware, freshness

router = APIRouter(prefix="/api", tags=["routing"])
HISTORY_LIMIT = 50


def _objective(req: RoutingPrefs, settings: Settings) -> Objective:
    return Objective(req.objective, req.transfer_penalty_s if req.transfer_penalty_s is not None
                     else settings.default_transfer_penalty_s, req.w_transfer_min, req.w_stop_min)


def _routing_error(exc: P.RoutingError, status: int = 422):
    return HTTPException(status, detail={"code": exc.code, "message": str(exc), "details": exc.details})


def _no_route(net: TransitNetwork, origin: str, dest: str, max_transfers: int | None) -> HTTPException:
    g = station_digraph(net)
    if not nx.has_path(g, origin, dest):
        connected = nx.has_path(g.to_undirected(as_view=True), origin, dest)
        msg = ("The stations are connected only against the direction of service." if connected else
               "The stations are in different, disconnected parts of the network; no route exists.")
        return HTTPException(422, detail={"code": "unreachable", "message": msg})
    if max_transfers is not None:
        return HTTPException(422, detail={"code": "transfer_limit", "message":
                                          f"No route exists with at most {max_transfers} train change(s)."})
    return HTTPException(422, detail={"code": "no_route", "message": "No route found."})


def _check(net: TransitNetwork, origin: str, dest: str):
    try:
        P.check_endpoints(net, origin, dest)
    except P.RoutingError as exc:
        raise _routing_error(exc, 404 if exc.code == "unknown_station" else 422) from exc


def _assumptions(net: TransitNetwork, objective: Objective, algorithm: str, journey: dict | None,
                 schedule: bool) -> list[str]:
    out = []
    if schedule:
        out.append("Times come from the published GTFS timetable (stop_times.txt) for the selected service day; "
                   "no real-time delays or disruptions are known.")
        if not net.has_transfer_data:
            out.append("The feed has no transfers.txt; a configurable minimum connection time is assumed when "
                       "changing trains.")
    else:
        out.append("Static routing: scheduled stop-to-stop times (median over trips, arrival to arrival) without "
                   "waiting for the first train. Pick a departure time for a timetable-based journey.")
        if journey and journey["metrics"]["transfers"] and not net.has_transfer_data:
            out.append(f"Each train change adds an assumed {objective.transfer_penalty_s}s allowance; the feed "
                       "has no transfer timing data.")
        if algorithm in ("gbfs", "bfs"):
            out.append(f"{P.ALGORITHM_INFO[algorithm]['name']} ignores edge costs; the route it found was costed "
                       "afterwards under the selected objective.")
        if journey and "straight_line_estimate" in journey["metrics"].get("distance_basis", []):
            out.append("Some segment distances are straight-line estimates (the feed's shape distance was missing "
                       "or implausible for them).")
    out.append("No fare information is shown: the dataset contains no fare data.")
    return out


def _record_history(session: Session, client: str | None, req: PlanRequest, act: ActiveNetwork) -> None:
    if not client or not req.record_history:
        return
    net = act.network
    params = req.model_dump(mode="json", exclude={"origin", "destination", "include_trace", "record_history"},
                            exclude_none=True)
    session.add(SavedRoute(client_id=client, kind="history", dataset_id=act.dataset.id, origin_id=req.origin,
                           destination_id=req.destination, origin_name=net.stations[req.origin].name,
                           destination_name=net.stations[req.destination].name, params=params))
    session.flush()
    ids = session.scalars(select(SavedRoute.id).where(SavedRoute.client_id == client, SavedRoute.kind == "history")
                          .order_by(SavedRoute.created_at.desc(), SavedRoute.id.desc()).offset(HISTORY_LIMIT)).all()
    if ids:
        session.execute(delete(SavedRoute).where(SavedRoute.id.in_(ids)))
    session.commit()


def build_plan(req: PlanRequest, act: ActiveNetwork, settings: Settings) -> dict:
    net = act.network
    _check(net, req.origin, req.destination)
    objective = _objective(req, settings)
    schedule_requested = req.depart_date is not None
    algorithm, reason = req.algorithm, None
    if algorithm == "auto":
        algorithm, reason = P.auto_select(net, objective, req.origin, req.destination, schedule_requested)
    base = {"request": req.model_dump(mode="json"), "algorithm": algorithm, "selection_reason": reason,
            "objective_description": objective.describe(),
            "dataset": {"id": act.dataset.id, "label": act.dataset.label, "attribution": act.dataset.attribution,
                        "imported_at": aware(act.dataset.imported_at),
                        "freshness": freshness(act.dataset, P.local_now(net).date())}}
    if schedule_requested and algorithm != "csa":
        base["notes"] = ["A departure time was given but a static algorithm was selected, so the timetable was "
                         "not used; results show scheduled stop-to-stop times only."]
    trace = P.make_trace(req.include_trace, settings)

    if algorithm == "csa":
        parts = [int(x) for x in req.depart_time.split(":")]
        depart_s = parts[0] * 3600 + parts[1] * 60 + (parts[2] if len(parts) > 2 else 0)
        if req.origin == req.destination:
            raise HTTPException(422, detail={"code": "same_station", "message":
                                             "Origin and destination are the same station."})
        try:
            journey = P.plan_schedule(net, req.origin, req.destination, req.depart_date, depart_s,
                                      min_transfer_s=req.min_transfer_s if req.min_transfer_s is not None
                                      else settings.default_min_transfer_s, trace=trace)
        except P.RoutingError as exc:
            raise _routing_error(exc) from exc
        search = journey.pop("search")
        warnings = journey.pop("warnings", [])
        base["objective_description"] = ("Earliest arrival using the published timetable; changing trains needs at "
                                          f"least {journey['metrics']['min_transfer_s']}s.")
        return base | {"mode": "schedule", "journey": journey, "search": search, "alternatives": [],
                       "warnings": warnings,
                       "assumptions": _assumptions(net, objective, algorithm, journey, True)}

    if req.origin == req.destination:
        journey = evaluate(net, objective, [req.origin])
        return base | {"mode": "static", "journey": journey, "search": None, "alternatives": [],
                       "assumptions": ["Origin and destination are the same station; no travel needed."]}
    try:
        result, journey = P.run_algorithm(net, algorithm, req.origin, req.destination, objective,
                                          max_transfers=req.max_transfers, trace=trace,
                                          timeout_s=settings.search_timeout_s)
    except SearchTimeout as exc:
        raise HTTPException(504, detail={"code": "search_timeout", "message": str(exc)}) from exc
    except (P.RoutingError, NegativeWeightError) as exc:
        raise HTTPException(422, detail={"code": getattr(exc, "code", "invalid_weights"), "message": str(exc)}) \
            from exc
    if not result.found:
        raise _no_route(net, req.origin, req.destination, req.max_transfers)
    alts = []
    if req.alternatives:
        alts = P.alternatives(net, objective, req.origin, req.destination, journey,
                              k=min(req.alternatives, settings.max_alternatives), max_transfers=req.max_transfers)
    warnings = []
    if not journey["constraints_satisfied"]:
        warnings.append(f"This algorithm does not enforce the transfer limit; the route uses "
                        f"{journey['metrics']['transfers']} change(s).")
    return base | {"mode": "static", "journey": journey, "search": P.serialize_search(result, net),
                   "alternatives": alts, "warnings": warnings,
                   "assumptions": _assumptions(net, objective, algorithm, journey, False)}


@router.post("/routes/plan", summary="Plan a route")
def plan(req: PlanRequest, act: ActiveNetwork = Depends(active), settings: Settings = Depends(get_settings),
         session: Session = Depends(get_session), client: str | None = Depends(optional_client_id)):
    out = build_plan(req, act, settings)
    _record_history(session, client, req, act)
    return out


@router.post("/algorithms/run", summary="Run one search algorithm with a full execution trace")
def run(req: RunRequest, act: ActiveNetwork = Depends(active), settings: Settings = Depends(get_settings)):
    net = act.network
    _check(net, req.origin, req.destination)
    objective = _objective(req, settings)
    trace = P.make_trace(req.trace, settings)
    try:
        result, journey = P.run_algorithm(net, req.algorithm, req.origin, req.destination, objective,
                                          max_transfers=req.max_transfers, trace=trace,
                                          timeout_s=settings.search_timeout_s)
    except SearchTimeout as exc:
        raise HTTPException(504, detail={"code": "search_timeout", "message": str(exc)}) from exc
    space_kind = "station graph" if req.algorithm in ("bfs", "gbfs") or not objective.route_aware \
        else "route-aware state graph (station × route)"
    heuristic = None
    if req.algorithm == "gbfs":
        heuristic = "h(n) = straight-line (great-circle) distance to the destination in km."
    elif req.algorithm == "astar":
        heuristic = {"time": f"h(n) = straight-line metres × {net.min_s_per_m:.4f} s/m (fastest observed "
                             "speed in the network), an admissible lower bound on remaining ride time.",
                     "transfers": "h(n) = (0, straight-line metres × fastest s/m): never overestimates either "
                                  "component.",
                     "distance": f"h(n) = straight-line metres × {net.min_dist_ratio:.3f} (smallest track/straight "
                                 "ratio over all edges).",
                     "stops": "h(n) = straight-line metres ÷ longest single hop: a lower bound on hops left.",
                     "balanced": "h(n) = lower bound on minutes + lower bound on stops × stop weight."}[objective.kind]
    return {"search": P.serialize_search(result, net), "journey": journey, "objective": objective.kind,
            "objective_description": objective.describe(), "space": space_kind, "heuristic": heuristic,
            "algorithm_info": P.ALGORITHM_INFO[req.algorithm]}


@router.post("/algorithms/compare", summary="Run several algorithms on identical inputs")
def compare(req: CompareRequest, act: ActiveNetwork = Depends(active), settings: Settings = Depends(get_settings)):
    net = act.network
    _check(net, req.origin, req.destination)
    if req.origin == req.destination:
        raise HTTPException(422, detail={"code": "same_station", "message": "Choose two different stations."})
    objective = _objective(req, settings)
    try:
        out = P.compare(net, req.origin, req.destination, objective, req.algorithms,
                        repeats=min(req.repeats, settings.benchmark_max_repeats), max_transfers=req.max_transfers,
                        timeout_s=settings.search_timeout_s)
    except SearchTimeout as exc:
        raise HTTPException(504, detail={"code": "search_timeout", "message": str(exc)}) from exc
    if not any(r["found"] for r in out["results"]):
        raise _no_route(net, req.origin, req.destination, req.max_transfers)
    out["notes"] = ["Execution times depend on the machine, graph size, Python interpreter state and caching; "
                    "compare them relative to one another on the same run, not as absolute figures.",
                    "Peak memory is Python heap allocation during one run measured with tracemalloc; it excludes "
                    "interpreter overhead.",
                    "BFS and GBFS ignore edge costs; their routes are costed afterwards under the same objective."]
    return out


@router.post("/routes/export", summary="Export a planned route as CSV or JSON")
def export(req: ExportRequest, act: ActiveNetwork = Depends(active), settings: Settings = Depends(get_settings)):
    plan_req = PlanRequest(**req.model_dump(exclude={"format"}) | {"include_trace": False})
    data = build_plan(plan_req, act, settings)
    if data.get("search"):
        data["search"].pop("trace", None)
        data["search"].pop("expansion_order", None)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    if req.format == "json":
        body = json.dumps(data, default=str, indent=2)
        return Response(body, media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="route-{stamp}.json"'})
    net = act.network
    journey = data["journey"]
    buf = io.StringIO()
    w = csv.writer(buf)
    legs = journey.get("legs") or journey.get("rides") or []
    w.writerow(["seq", "station_id", "station_name", "lat", "lon", "role", "line", "route", "departure", "arrival"])
    seq = 0
    for li, leg in enumerate(legs):
        names = leg["stations"] if li == 0 else leg["stations"][1:]
        for s in names:
            st = net.stations[s]
            role = next((x["role"] for x in journey["stations"] if x["id"] == s), "")
            w.writerow([seq, s, st.name, st.lat, st.lon, role, leg["line_name"], leg.get("route_long_name"),
                        leg.get("departure", "") if s == leg["stations"][0] else "",
                        leg.get("arrival", "") if s == leg["stations"][-1] else ""])
            seq += 1
    w.writerow([])
    for k, v in journey["metrics"].items():
        w.writerow(["#", k, v])
    w.writerow(["#", "algorithm", data["algorithm"]])
    w.writerow(["#", "dataset", data["dataset"]["label"]])
    w.writerow(["#", "attribution", data["dataset"]["attribution"]])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="route-{stamp}.csv"'})


@router.get("/routes/schedule-status", summary="Whether the timetable covers a date")
def schedule_status(date: str, act: ActiveNetwork = Depends(active)):
    try:
        d = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(422, detail={"code": "bad_date", "message": "Use YYYY-MM-DD."}) from exc
    return P.schedule_status(act.network, d) | {"supported": act.network.schedule_supported}

