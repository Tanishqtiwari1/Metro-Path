"""API + persistence integration tests against a temporary SQLite database."""

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.state import store

from .gtfs_factory import build_zip, standard_zip

ADMIN = {"Authorization": "Bearer test-admin-token"}
CLIENT = {"X-Client-Id": "pytest-client-0001"}


@pytest.fixture(scope="module")
def client():
    store.clear()
    with TestClient(create_app()) as c:
        yield c
    store.clear()


def upload(client, data: bytes, name="feed.zip", activate=True, headers=ADMIN):
    return client.post("/api/admin/datasets/upload", headers=headers,
                       files={"file": (name, data, "application/zip")},
                       data={"label": name, "activate": str(activate).lower()})


def test_01_no_dataset_gives_honest_empty_state(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    r = client.get("/api/meta")
    assert r.status_code == 503 and r.json()["error"]["code"] == "no_dataset"
    assert client.get("/api/ready").status_code == 503
    r = client.post("/api/routes/plan", json={"origin": "S1", "destination": "S6"})
    assert r.status_code == 503


def test_02_admin_actions_require_token(client):
    assert upload(client, standard_zip(), headers={}).status_code == 401
    assert upload(client, standard_zip(), headers={"Authorization": "Bearer wrong"}).status_code == 403


def test_03_invalid_upload_recorded_without_activation(client):
    r = upload(client, b"not a zip", name="bad.zip")
    assert r.status_code == 422 and r.json()["error"]["code"] == "import_failed"
    ds = client.get("/api/datasets").json()
    assert ds[0]["status"] == "failed" and not ds[0]["is_active"]


def test_04_upload_and_activate(client):
    r = upload(client, standard_zip(), name="fixture-v1.zip")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "valid" and body["is_active"]
    assert body["stats"]["components"] == 2
    assert any(w["code"] == "disconnected_network" for w in body["report"]["warnings"])
    assert any("Import committed" in log["message"] for log in body["logs"])
    meta = client.get("/api/meta").json()
    assert meta["counts"]["stations"] == 9
    assert client.get("/api/ready").status_code == 200


def test_05_duplicate_upload_rejected(client):
    r = upload(client, standard_zip(), name="again.zip")
    assert r.status_code == 422 and "identical" in r.json()["error"]["message"]


def test_06_station_search_pagination_and_details(client):
    r = client.get("/api/stations", params={"q": "", "limit": 4, "offset": 4}).json()
    assert r["total"] == 9 and len(r["items"]) == 4
    r = client.get("/api/stations", params={"q": "charlie"}).json()
    assert r["items"][0]["id"] == "S3" and r["items"][0]["interchange"]
    d = client.get("/api/stations/S3").json()
    assert {n["id"] for n in d["neighbors"]} == {"S2", "S4", "S5", "S6"}
    assert d["accessibility_note"]
    assert client.get("/api/stations/NOPE").status_code == 404
    near = client.get("/api/stations/nearby", params={"lat": 28.6, "lon": 77.2, "radius_m": 1200}).json()
    assert near[0]["id"] == "S1" and all(n["distance_m"] <= 1200 for n in near)


def test_07_plan_route_and_history(client):
    r = client.post("/api/routes/plan", headers=CLIENT,
                    json={"origin": "S1", "destination": "S6", "alternatives": 2, "include_trace": True})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["algorithm"] == "astar" and b["selection_reason"]
    assert b["journey"]["metrics"]["total_time_s"] == 700
    assert b["search"]["trace"]["events"]
    assert b["alternatives"] and b["assumptions"]
    hist = client.get("/api/me/saved", params={"kind": "history"}, headers=CLIENT).json()
    assert hist[0]["origin_id"] == "S1" and hist[0]["destination_id"] == "S6"


def test_08_plan_errors(client):
    def err(payload, status, code):
        r = client.post("/api/routes/plan", json=payload)
        assert r.status_code == status, r.text
        assert r.json()["error"]["code"] == code

    err({"origin": "S1", "destination": "S8"}, 422, "unreachable")
    err({"origin": "S1", "destination": "NOPE"}, 404, "unknown_station")
    err({"origin": "S1", "destination": "S6", "objective": "fastest"}, 422, "validation_error")
    err({"origin": "S1", "destination": "S6", "depart_time": "08:00"}, 422, "validation_error")
    err({"origin": "S1", "destination": "S6", "algorithm": "csa"}, 422, "validation_error")
    err({"origin": "S2", "destination": "S5", "max_transfers": 0, "algorithm": "dijkstra"}, 422, "transfer_limit")
    err({"origin": "S1'; DROP TABLE stops;--", "destination": "S6"}, 422, "validation_error")
    err({"origin": "S1", "destination": "S6", "depart_date": "2040-01-01", "depart_time": "08:00"}, 422,
        "no_service_on_date")


def test_09_same_station(client):
    r = client.post("/api/routes/plan", json={"origin": "S1", "destination": "S1"}).json()
    assert r["journey"]["metrics"]["stops"] == 0


def test_10_schedule_plan(client):
    r = client.post("/api/routes/plan", json={"origin": "S1", "destination": "S6", "depart_date": "2025-01-01",
                                              "depart_time": "06:00"})
    assert r.status_code == 200, r.text
    assert r.json()["mode"] == "schedule" and r.json()["algorithm"] == "csa"


def test_11_algorithm_lab_and_compare(client):
    r = client.post("/api/algorithms/run", json={"origin": "S1", "destination": "S6", "algorithm": "gbfs"}).json()
    assert r["search"]["trace"]["events"][0]["type"] == "expand" and "straight-line" in r["heuristic"]
    c = client.post("/api/algorithms/compare", json={"origin": "S1", "destination": "S6", "repeats": 3}).json()
    assert {x["algorithm"] for x in c["results"]} == {"gbfs", "bfs", "dijkstra", "astar"}
    assert c["notes"]


def test_12_export(client):
    r = client.post("/api/routes/export", json={"origin": "S1", "destination": "S6", "format": "csv"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert r.text.splitlines()[0].startswith("seq,station_id")
    j = client.post("/api/routes/export", json={"origin": "S1", "destination": "S6", "format": "json"})
    assert "attachment" in j.headers["content-disposition"] and j.json()["journey"]


def test_13_favorites_crud(client):
    assert client.get("/api/me/saved").status_code == 400  # client id required
    r = client.post("/api/me/saved", headers=CLIENT, json={"origin": "S1", "destination": "S4", "label": "Commute"})
    assert r.status_code == 201
    fid = r.json()["id"]
    favs = client.get("/api/me/saved", headers=CLIENT).json()
    assert [f["label"] for f in favs] == ["Commute"]
    assert client.get("/api/me/saved", headers={"X-Client-Id": "someone-else-01"}).json() == []
    assert client.delete(f"/api/me/saved/{fid}", headers={"X-Client-Id": "someone-else-01"}).status_code == 404
    assert client.delete(f"/api/me/saved/{fid}", headers=CLIENT).status_code == 204


def test_14_analytics(client):
    a = client.get("/api/analytics/network").json()
    assert a["summary"]["connected_components"] == 2 and a["summary"]["interchanges"] >= 1
    assert a["top_betweenness"][0]["name"]
    b = client.get("/api/analytics/benchmark", params={"pairs": 5}).json()
    assert len(b["results"]) == 4


def test_15_new_dataset_changes_network_and_rollback(client):
    stops = [("X1", "Xenon", 28.5, 77.0), ("X2", "Yttrium", 28.5, 77.01), ("X3", "Zirconium", 28.5, 77.02)]
    trips = [{"trip_id": f"t{i}", "route_id": "R", "stops": ["X1", "X2", "X3"], "start": 3600 + i * 600}
             for i in range(3)]
    data = build_zip(stops, [("R", "R", "RED_Xenon to Zirconium")], trips)
    r = upload(client, data, name="fixture-v2.zip")
    assert r.status_code == 200, r.text
    v2 = r.json()["id"]
    names = [s["name"] for s in client.get("/api/stations").json()["items"]]
    assert names == ["Xenon", "Yttrium", "Zirconium"]
    assert client.get("/api/stations/S1").status_code == 404
    # Roll back to v1.
    v1 = next(d["id"] for d in client.get("/api/datasets").json() if d["label"] == "fixture-v1.zip")
    r = client.post(f"/api/admin/datasets/{v1}/activate", headers=ADMIN)
    assert r.status_code == 200 and r.json()["is_active"]
    assert client.get("/api/meta").json()["counts"]["stations"] == 9
    assert not next(d for d in client.get("/api/datasets").json() if d["id"] == v2)["is_active"]


def test_16_failed_import_keeps_active_dataset(client):
    active_before = client.get("/api/meta").json()["dataset"]["id"]
    bad = build_zip([("Q1", "Q", 1, 1)], [("R", "R", "R")], [],
                    extra={"stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"})
    r = upload(client, bad, name="empty.zip")
    assert r.status_code == 422
    assert client.get("/api/meta").json()["dataset"]["id"] == active_before
    detail = client.get(f"/api/datasets/{r.json()['error']['details']['dataset_id']}").json()
    assert detail["status"] == "failed" and detail["report"]["errors"]


def test_17_persistence_survives_restart(client):
    store.clear()
    with TestClient(create_app()) as c2:
        assert c2.get("/api/meta").json()["counts"]["stations"] == 9
        assert c2.get("/api/me/saved", params={"kind": "history"}, headers=CLIENT).json()


def test_18_openapi_available(client):
    spec = client.get("/api/openapi.json").json()
    assert "/api/routes/plan" in spec["paths"]
