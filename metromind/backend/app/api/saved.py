from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import SavedRoute
from ..schemas import SavedRouteIn, SavedRouteOut
from ..security import client_id
from ..state import ActiveNetwork
from .common import active, aware

router = APIRouter(prefix="/api/me", tags=["favorites & history"])
FAVORITE_LIMIT = 100


def _out(r: SavedRoute) -> dict:
    out = {c: getattr(r, c) for c in ("id", "kind", "origin_id", "destination_id", "origin_name",
                                      "destination_name", "params", "label", "dataset_id")}
    return out | {"created_at": aware(r.created_at)}


@router.get("/saved", response_model=list[SavedRouteOut], summary="Favourites or recent searches")
def list_saved(kind: Literal["favorite", "history"] = Query("favorite"), client: str = Depends(client_id),
               session: Session = Depends(get_session)):
    rows = session.scalars(select(SavedRoute).where(SavedRoute.client_id == client, SavedRoute.kind == kind)
                           .order_by(SavedRoute.created_at.desc(), SavedRoute.id.desc()).limit(100)).all()
    return [_out(r) for r in rows]


@router.post("/saved", response_model=SavedRouteOut, status_code=201, summary="Save a favourite route")
def save(body: SavedRouteIn, client: str = Depends(client_id), session: Session = Depends(get_session),
         act: ActiveNetwork = Depends(active)):
    net = act.network
    for sid in (body.origin, body.destination):
        if sid not in net.stations:
            raise HTTPException(404, detail={"code": "unknown_station", "message": f"Unknown station {sid!r}."})
    count = len(session.scalars(select(SavedRoute.id).where(SavedRoute.client_id == client,
                                                            SavedRoute.kind == body.kind)).all())
    if count >= FAVORITE_LIMIT:
        raise HTTPException(409, detail={"code": "limit", "message": f"At most {FAVORITE_LIMIT} saved routes."})
    row = SavedRoute(client_id=client, kind=body.kind, dataset_id=act.dataset.id, origin_id=body.origin,
                     destination_id=body.destination, origin_name=net.stations[body.origin].name,
                     destination_name=net.stations[body.destination].name, params=body.params, label=body.label)
    session.add(row)
    session.commit()
    return _out(row)


@router.delete("/saved/{saved_id}", status_code=204, summary="Delete a saved route or history entry")
def remove(saved_id: int, client: str = Depends(client_id), session: Session = Depends(get_session)):
    res = session.execute(delete(SavedRoute).where(SavedRoute.id == saved_id, SavedRoute.client_id == client))
    session.commit()
    if res.rowcount == 0:
        raise HTTPException(404, detail={"code": "not_found", "message": "Not found."})


@router.delete("/history", status_code=204, summary="Clear search history")
def clear_history(client: str = Depends(client_id), session: Session = Depends(get_session)):
    session.execute(delete(SavedRoute).where(SavedRoute.client_id == client, SavedRoute.kind == "history"))
    session.commit()
