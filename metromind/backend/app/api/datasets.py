from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import get_session
from ..ingestion.archive import ArchiveError
from ..ingestion.importer import ImportFailed, activate_dataset, download_source, import_archive
from ..models import DatasetVersion, ImportLog
from ..schemas import DatasetDetail, DatasetOut
from ..security import require_admin
from ..state import store
from .common import aware, dataset_out

router = APIRouter(prefix="/api", tags=["datasets"])


def _detail(session: Session, ds: DatasetVersion) -> dict:
    logs = session.scalars(select(ImportLog).where(ImportLog.dataset_id == ds.id).order_by(ImportLog.id)).all()
    return dataset_out(ds) | {"report": ds.report or {},
                              "logs": [{"at": aware(lg.created_at), "level": lg.level, "message": lg.message}
                                       for lg in logs]}


@router.get("/datasets", response_model=list[DatasetOut], summary="Import history")
def list_datasets(session: Session = Depends(get_session)):
    rows = session.scalars(select(DatasetVersion).order_by(DatasetVersion.id.desc())).all()
    return [dataset_out(d) for d in rows]


@router.get("/datasets/{dataset_id}", response_model=DatasetDetail, summary="Validation report and import log")
def get_dataset(dataset_id: int, session: Session = Depends(get_session)):
    ds = session.get(DatasetVersion, dataset_id)
    if ds is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "No such dataset version."})
    return _detail(session, ds)


def _after_import(session: Session, ds: DatasetVersion) -> dict:
    if ds.is_active:
        store.clear()
        store.reload(session)
    return _detail(session, ds)


def _import_error(exc: Exception, session: Session) -> HTTPException:
    details = {}
    if isinstance(exc, ImportFailed) and exc.dataset_id:
        ds = session.get(DatasetVersion, exc.dataset_id)
        details = {"dataset_id": exc.dataset_id, "report": ds.report if ds else None}
    return HTTPException(422, detail={"code": "import_failed", "message": str(exc), "details": details})


@router.post("/admin/datasets/upload", dependencies=[Depends(require_admin)], response_model=DatasetDetail,
             summary="Upload and import a GTFS ZIP")
async def upload(file: UploadFile = File(...), label: str = Form("", max_length=200), activate: bool = Form(True),
                 session: Session = Depends(get_session), settings: Settings = Depends(get_settings)):
    limit = settings.max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, detail={"code": "too_large",
                                         "message": f"Upload exceeds {settings.max_upload_mb} MB."})
    name = (file.filename or "upload.zip").replace("/", "_").replace("\\", "_")[:255]
    try:
        ds = import_archive(session, data, settings=settings, source_kind="upload", filename=name,
                            label=label or f"Upload: {name}", activate=activate,
                            attribution=settings.dataset_source_attribution)
    except ImportFailed as exc:
        raise _import_error(exc, session) from exc
    return _after_import(session, ds)


@router.post("/admin/datasets/refresh", dependencies=[Depends(require_admin)], response_model=DatasetDetail,
             summary="Download and import from the configured source URL")
def refresh(session: Session = Depends(get_session), settings: Settings = Depends(get_settings)):
    if not settings.dataset_source_url:
        raise HTTPException(409, detail={"code": "no_source_url", "message":
                                         "No METROMIND_DATASET_SOURCE_URL is configured. The official DMRC portal "
                                         "requires a declaration form, so download the ZIP there and upload it."})
    try:
        data = download_source(settings.dataset_source_url, settings)
    except (ArchiveError, OSError) as exc:
        raise HTTPException(502, detail={"code": "download_failed", "message": f"Download failed: {exc}"}) from exc
    except Exception as exc:  # httpx errors
        raise HTTPException(502, detail={"code": "download_failed",
                                         "message": f"Download failed: {exc.__class__.__name__}"}) from exc
    try:
        ds = import_archive(session, data, settings=settings, source_kind="url", source_url=settings.dataset_source_url,
                            label=settings.dataset_source_label, attribution=settings.dataset_source_attribution)
    except ImportFailed as exc:
        raise _import_error(exc, session) from exc
    return _after_import(session, ds)


@router.post("/admin/datasets/{dataset_id}/activate", dependencies=[Depends(require_admin)],
             response_model=DatasetOut, summary="Activate (or roll back to) a valid dataset version")
def activate(dataset_id: int, session: Session = Depends(get_session)):
    ds = session.get(DatasetVersion, dataset_id)
    if ds is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "No such dataset version."})
    if ds.status != "valid":
        raise HTTPException(409, detail={"code": "not_valid", "message": "Only valid datasets can be activated."})
    previous = store.peek()
    activate_dataset(session, ds)
    try:
        store.clear()
        store.reload(session)
    except Exception as exc:
        # Restore the previous dataset so the service keeps working.
        if previous:
            prev = session.get(DatasetVersion, previous.dataset.id)
            activate_dataset(session, prev)
            store.clear()
            store.reload(session)
        raise HTTPException(500, detail={"code": "activation_failed",
                                         "message": f"Graph build failed; previous dataset restored "
                                                    f"({exc.__class__.__name__})."}) from exc
    return dataset_out(ds)


@router.post("/admin/graph/rebuild", dependencies=[Depends(require_admin)], summary="Rebuild the in-memory graph")
def rebuild(session: Session = Depends(get_session)):
    store.clear()
    act = store.reload(session)
    if act is None:
        raise HTTPException(409, detail={"code": "no_dataset", "message": "No active dataset to build."})
    return {"dataset_id": act.dataset.id, "stations": len(act.network.stations), "edges": len(act.network.edges),
            "notes": act.network.notes}


@router.get("/admin/check", dependencies=[Depends(require_admin)], summary="Verify an admin token")
def check():
    return {"ok": True}
