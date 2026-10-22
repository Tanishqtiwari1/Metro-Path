"""MetroMind API application."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from .api import analytics, datasets, network, routes, saved
from .config import BACKEND_DIR, get_settings
from .db import SessionLocal, engine
from .state import store

log = logging.getLogger("metromind")


def run_migrations() -> None:
    from alembic.config import Config

    from alembic import command

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", str(engine.url.render_as_string(hide_password=False)))
    command.upgrade(cfg, "head")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if settings.auto_migrate:
        run_migrations()
    try:
        with SessionLocal() as session:
            act = store.reload(session)
        if act:
            log.info("Active dataset #%s loaded: %d stations, %d edges", act.dataset.id,
                     len(act.network.stations), len(act.network.edges))
        else:
            log.warning("No active dataset. Import one via the admin API or `python -m app.cli import`.")
    except Exception:
        log.exception("Failed to load the active dataset; the API will report no_dataset.")
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="MetroMind API", version="1.0.0", lifespan=lifespan,
                  description="Transit route planning, search-algorithm visualisation and network analytics over "
                              "imported GTFS data.",
                  docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    app.add_middleware(GZipMiddleware, minimum_size=2048)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False,
                       allow_methods=["GET", "POST", "DELETE"], allow_headers=["Authorization", "Content-Type",
                                                                                "X-Client-Id"])
    from .security import RateLimitMiddleware
    app.add_middleware(RateLimitMiddleware, per_minute=settings.rate_limit_per_minute)

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException):
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": "http_error", "message": str(exc.detail)}
        detail.setdefault("details", {})
        return JSONResponse({"error": detail}, status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        errors = [{"loc": [str(p) for p in e.get("loc", [])], "msg": e.get("msg")} for e in exc.errors()]
        return JSONResponse({"error": {"code": "validation_error", "message": "Invalid request.",
                                       "details": {"errors": errors}}}, status_code=422)

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception):
        log.exception("Unhandled error")
        return JSONResponse({"error": {"code": "internal_error", "message": "An unexpected error occurred.",
                                       "details": {}}}, status_code=500)

    @app.get("/api/health", tags=["ops"], summary="Liveness")
    def health():
        return {"status": "ok"}

    @app.get("/api/ready", tags=["ops"], summary="Readiness: database reachable and a dataset is active")
    def ready():
        db_ok = True
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception:
            db_ok = False
        act = store.peek()
        body = {"database": db_ok, "dataset_loaded": act is not None,
                "dataset_id": act.dataset.id if act else None}
        return JSONResponse(body, status_code=200 if db_ok and act else 503)

    for r in (network.router, routes.router, analytics.router, datasets.router, saved.router):
        app.include_router(r)

    if settings.frontend_dist and Path(settings.frontend_dist).is_dir():
        dist = Path(settings.frontend_dist).resolve()
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path == "api" or path.startswith("api/"):
                raise HTTPException(404, detail={"code": "not_found", "message": "Unknown API endpoint."})
            candidate = (dist / path).resolve()
            if path and candidate.is_file() and dist in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(dist / "index.html")

    return app


app = create_app()
