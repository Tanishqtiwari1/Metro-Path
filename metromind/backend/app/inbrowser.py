"""In-browser runtime (Pyodide) used by the static GitHub Pages build.

The browser has no server, so instead of FastAPI's HTTP layer this module dispatches
``/api/...`` requests straight to the same handler functions the server uses. The
algorithms, graph construction, validation and evaluation are therefore identical; only
transport differs. Data lives in an in-memory SQLite database; saved routes are
round-tripped through the page's localStorage by the worker.
"""

import json
import re
import traceback
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import ValidationError
from sqlalchemy import select

from .api import analytics as analytics_api
from .api import datasets as datasets_api
from .api import network as network_api
from .api import routes as routes_api
from .api import saved as saved_api
from .config import get_settings
from .db import Base, SessionLocal, engine
from .graph.network import TransitNetwork
from .ingestion.archive import read_archive
from .ingestion.importer import graph_report
from .ingestion.parser import parse_feed
from .models import DatasetVersion, ImportLog, SavedRoute
from .schemas import CompareRequest, ExportRequest, PlanRequest, RunRequest, SavedRouteIn
from .state import ActiveNetwork, store

_CLIENT_RE = re.compile(r"^[A-Za-z0-9\-]{8,64}$")


def boot(dataset_zip: bytes, manifest_json: str) -> dict:
    """Validate and load the bundled feed exactly like an import, minus bulk persistence."""
    settings = get_settings()
    manifest = json.loads(manifest_json)
    Base.metadata.create_all(engine)
    archive = read_archive(dataset_zip, max_uncompressed_bytes=settings.max_uncompressed_mb * 1024 * 1024,
                           max_ratio=settings.max_compression_ratio)
    if manifest.get("sha256") and manifest["sha256"] != archive.sha256:
        raise ValueError("Bundled dataset does not match the checksum in its manifest.")
    feed, report = parse_feed(archive)
    net = TransitNetwork(feed, line_group_pattern=settings.line_group_pattern,
                         infer_colors=settings.infer_line_colors)
    greport = graph_report(net)
    report.info["graph"] = greport
    if greport["components"] > 1:
        report.warn("disconnected_network", f"The network has {greport['components']} disconnected components; "
                    "some station pairs have no route.", count=greport["components"])
    with SessionLocal() as session:
        ds = DatasetVersion(
            label=manifest.get("label", "Bundled GTFS dataset"), source_kind="bundled",
            source_url=manifest.get("source_url"), source_filename=manifest.get("filename"),
            attribution=manifest.get("attribution") or settings.dataset_source_attribution,
            sha256=archive.sha256, status="valid", is_active=True,
            activated_at=datetime.now(timezone.utc), feed_version=feed.feed_version,
            service_start=feed.service_start, service_end=feed.service_end, timezone=feed.timezone,
            report=report.as_dict(),
            stats=greport | {k: report.info.get(k) for k in ("stops", "routes", "trips", "stop_times",
                                                              "shape_points")})
        session.add(ds)
        session.flush()
        session.add(ImportLog(dataset_id=ds.id, level="info",
                              message="Loaded in the browser from the bundled archive (static demo)."))
        session.commit()
        session.expunge(ds)
    store._active = ActiveNetwork(ds, net)
    return {"stations": len(net.stations), "edges": len(net.edges)}


def load_saved(saved_json: str) -> None:
    try:
        rows = json.loads(saved_json or "[]")
    except ValueError:
        return
    with SessionLocal() as session:
        for r in rows[:500]:
            try:
                session.add(SavedRoute(
                    client_id=str(r["client_id"]), kind=r["kind"], dataset_id=None,
                    origin_id=str(r["origin_id"]), destination_id=str(r["destination_id"]),
                    origin_name=str(r["origin_name"]), destination_name=str(r["destination_name"]),
                    params=r.get("params") or {}, label=r.get("label"),
                    created_at=datetime.fromisoformat(r["created_at"])))
            except (KeyError, TypeError, ValueError):
                continue
        session.commit()


def dump_saved() -> str:
    with SessionLocal() as session:
        rows = session.scalars(select(SavedRoute).order_by(SavedRoute.id)).all()
        return json.dumps([{"client_id": r.client_id, "kind": r.kind, "origin_id": r.origin_id,
                            "destination_id": r.destination_id, "origin_name": r.origin_name,
                            "destination_name": r.destination_name, "params": r.params, "label": r.label,
                            "created_at": r.created_at.isoformat()} for r in rows])


def _int(q: dict, name: str, default: int, lo: int, hi: int) -> int:
    raw = q.get(name)
    if raw in (None, ""):
        return default
    try:
        v = int(raw)
    except ValueError:
        v = None
    if v is None or not lo <= v <= hi:
        raise HTTPException(422, detail={"code": "validation_error", "message": f"Invalid {name}."})
    return v


def _float(q: dict, name: str, lo: float, hi: float, default: float | None = None) -> float:
    raw = q.get(name)
    if raw in (None, ""):
        if default is None:
            raise HTTPException(422, detail={"code": "validation_error", "message": f"Missing {name}."})
        return default
    try:
        v = float(raw)
    except ValueError:
        v = float("nan")
    if not lo <= v <= hi:
        raise HTTPException(422, detail={"code": "validation_error", "message": f"Invalid {name}."})
    return v


def _client(headers: dict) -> str:
    cid = headers.get("x-client-id", "")
    if not _CLIENT_RE.match(cid):
        raise HTTPException(400, detail={"code": "client_id_required", "message": "Missing client id."})
    return cid


def _dispatch(method: str, path: str, q: dict, headers: dict, body: Any):
    settings = get_settings()
    act = _active
    m = re.fullmatch

    if method == "GET":
        if path == "/api/health":
            return {"status": "ok"}
        if path == "/api/ready":
            return {"database": True, "dataset_loaded": store.peek() is not None, "dataset_id": 1}
        if path == "/api/meta":
            return network_api.meta(act(), settings)
        if path == "/api/stations":
            query = q.get("q", "")
            if len(query) > 100:
                raise HTTPException(422, detail={"code": "validation_error", "message": "Query too long."})
            return network_api.stations(query, _int(q, "limit", 20, 1, 500), _int(q, "offset", 0, 0, 10**6), act())
        if path == "/api/stations/nearby":
            return network_api.nearby(_float(q, "lat", -90, 90), _float(q, "lon", -180, 180),
                                      _float(q, "radius_m", 1e-9, 50_000, 1500), _int(q, "limit", 10, 1, 100),
                                      act())
        if mm := m(r"/api/stations/([^/]+)", path):
            return network_api.station_detail(mm.group(1), act())
        if path == "/api/network/map":
            return network_api.network_map(act())
        if path == "/api/algorithms":
            return network_api.algorithms()
        if path == "/api/routes/schedule-status":
            return routes_api.schedule_status(q.get("date", ""), act())
        if path == "/api/analytics/network":
            return analytics_api.network(act())
        if path == "/api/analytics/benchmark":
            objective = q.get("objective", "time")
            if objective not in ("time", "transfers", "distance", "stops", "balanced"):
                raise HTTPException(422, detail={"code": "validation_error", "message": "Invalid objective."})
            return analytics_api.benchmark(_int(q, "pairs", 30, 5, 200), _int(q, "seed", 42, 0, 10_000), objective,
                                           act(), settings)
        if path == "/api/datasets":
            with SessionLocal() as s:
                return datasets_api.list_datasets(s)
        if mm := m(r"/api/datasets/(\d+)", path):
            with SessionLocal() as s:
                return datasets_api.get_dataset(int(mm.group(1)), s)
        if path == "/api/me/saved":
            kind = q.get("kind", "favorite")
            if kind not in ("favorite", "history"):
                raise HTTPException(422, detail={"code": "validation_error", "message": "Invalid kind."})
            with SessionLocal() as s:
                return saved_api.list_saved(kind, _client(headers), s)

    if method == "POST":
        if path == "/api/routes/plan":
            req = PlanRequest.model_validate(body)
            out = routes_api.build_plan(req, act(), settings)
            with SessionLocal() as s:
                routes_api._record_history(s, headers.get("x-client-id") if _CLIENT_RE.match(
                    headers.get("x-client-id", "")) else None, req, act())
            return out
        if path == "/api/algorithms/run":
            return routes_api.run(RunRequest.model_validate(body), act(), settings)
        if path == "/api/algorithms/compare":
            return routes_api.compare(CompareRequest.model_validate(body), act(), settings)
        if path == "/api/routes/export":
            return routes_api.export(ExportRequest.model_validate(body), act(), settings)
        if path == "/api/me/saved":
            with SessionLocal() as s:
                return 201, saved_api.save(SavedRouteIn.model_validate(body), _client(headers), s, act())

    if method == "DELETE":
        if mm := m(r"/api/me/saved/(\d+)", path):
            with SessionLocal() as s:
                saved_api.remove(int(mm.group(1)), _client(headers), s)
            return 204, None
        if path == "/api/me/history":
            with SessionLocal() as s:
                saved_api.clear_history(_client(headers), s)
            return 204, None

    if path.startswith("/api/admin/"):
        raise HTTPException(503, detail={"code": "admin_disabled", "message":
                                         "This is the static in-browser demo: the dataset is bundled with the site, "
                                         "so uploads and refreshes are unavailable. Run the full server to manage "
                                         "datasets."})
    raise HTTPException(404, detail={"code": "not_found", "message": "Unknown API endpoint."})


def _active() -> ActiveNetwork:
    from .api.common import active
    return active()


def handle(method: str, url: str, headers_json: str, body_text: str | None) -> dict:
    """Entry point called by the web worker. Returns {status, headers, body(str)}."""
    from urllib.parse import parse_qsl, urlsplit

    parts = urlsplit(url)
    q = dict(parse_qsl(parts.query, keep_blank_values=True))
    headers = {k.lower(): v for k, v in json.loads(headers_json or "{}").items()}
    status, out_headers = 200, {"content-type": "application/json"}
    try:
        body = json.loads(body_text) if body_text else None
        result = _dispatch(method.upper(), parts.path, q, headers, body)
        if isinstance(result, tuple):
            status, result = result
        if hasattr(result, "body") and hasattr(result, "headers"):  # starlette Response (export)
            return {"status": result.status_code, "headers": dict(result.headers),
                    "body": result.body.decode("utf-8")}
        text = "" if result is None else json.dumps(jsonable_encoder(result))
        return {"status": status, "headers": out_headers, "body": text}
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": "http_error", "message": str(exc.detail)}
        detail.setdefault("details", {})
        return {"status": exc.status_code, "headers": out_headers,
                "body": json.dumps({"error": jsonable_encoder(detail)})}
    except ValidationError as exc:
        errors = [{"loc": [str(p) for p in e.get("loc", [])], "msg": e.get("msg")} for e in exc.errors()]
        return {"status": 422, "headers": out_headers, "body": json.dumps(
            {"error": {"code": "validation_error", "message": "Invalid request.", "details": {"errors": errors}}})}
    except json.JSONDecodeError:
        return {"status": 400, "headers": out_headers, "body": json.dumps(
            {"error": {"code": "bad_json", "message": "Request body is not valid JSON.", "details": {}}})}
    except Exception:
        traceback.print_exc()
        return {"status": 500, "headers": out_headers, "body": json.dumps(
            {"error": {"code": "internal_error", "message": "An unexpected error occurred.", "details": {}}})}
