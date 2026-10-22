# API reference (summary)

Interactive OpenAPI docs: **`/api/docs`** (JSON at `/api/openapi.json`). All errors use:

```json
{ "error": { "code": "unreachable", "message": "…", "details": {} } }
```

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness |
| GET | `/api/ready` | DB reachable and dataset loaded (503 otherwise) |
| GET | `/api/meta` | Active dataset, freshness, capabilities (objectives, schedule window), defaults, algorithms |
| GET | `/api/stations?q=&limit=&offset=` | Ranked, paginated station search |
| GET | `/api/stations/nearby?lat=&lon=&radius_m=&limit=` | Stations within a radius (straight line) |
| GET | `/api/stations/{id}` | Lines, routes, neighbours, scheduled first/last departures, data notes |
| GET | `/api/network/map` | Stations, route geometries (shapes or station sequence), line legend, bounds |
| GET | `/api/algorithms` | Algorithm descriptions |
| POST | `/api/routes/plan` | Plan a route (static or timetable), optional alternatives and trace |
| GET | `/api/routes/schedule-status?date=YYYY-MM-DD` | Whether the timetable covers a date (+ suggested date) |
| POST | `/api/routes/export` | Same body as plan + `format: csv\|json` → file download |
| POST | `/api/algorithms/run` | One search algorithm with a full execution trace |
| POST | `/api/algorithms/compare` | Several algorithms, identical inputs, repeated timings, optimality |
| GET | `/api/analytics/network` | Topology metrics (cached per dataset) |
| GET | `/api/analytics/benchmark?pairs=&seed=&objective=` | Seeded random-pair benchmark |
| GET | `/api/datasets` | Import history |
| GET | `/api/datasets/{id}` | Validation report + import log |
| POST | `/api/admin/datasets/upload` 🔒 | Multipart GTFS ZIP upload (`file`, `label`, `activate`) |
| POST | `/api/admin/datasets/refresh` 🔒 | Download from `METROMIND_DATASET_SOURCE_URL` and import |
| POST | `/api/admin/datasets/{id}/activate` 🔒 | Activate / roll back |
| POST | `/api/admin/graph/rebuild` 🔒 | Rebuild the in-memory graph |
| GET | `/api/admin/check` 🔒 | Verify a token |
| GET/POST | `/api/me/saved` | Favourites / history (header `X-Client-Id`) |
| DELETE | `/api/me/saved/{id}`, `/api/me/history` | Delete a saved item / clear history |

🔒 = `Authorization: Bearer <METROMIND_ADMIN_TOKEN>`.

## Plan request

```json
{
  "origin": "21",
  "destination": "81",
  "objective": "time",              // time | transfers | distance | stops | balanced
  "algorithm": "auto",              // auto | gbfs | bfs | dijkstra | astar | csa
  "max_transfers": null,            // 0..10
  "transfer_penalty_s": 300,        // assumed allowance per change (static)
  "w_transfer_min": 5, "w_stop_min": 0.5,   // balanced weights
  "alternatives": 2,
  "depart_date": "2025-12-25", "depart_time": "08:30",   // together → timetable routing
  "min_transfer_s": 120,
  "include_trace": false
}
```

Response (static): `journey.stations[]` (with roles origin/transfer/pass/destination), `journey.rides[]`
(line, route, stations, ride time, distance, geometry), `journey.metrics` (stops, transfers,
line_changes, in-vehicle, transfer allowance, total, distance + basis, objective cost and unit),
`search` (algorithm, runtime, expanded, generated, discovered, optional trace), `alternatives[]` with
`tradeoff`, `assumptions[]`, `dataset` (label, attribution, freshness), and `selection_reason` in auto
mode.

Response (schedule): `journey.legs[]` with trip id, departure/arrival clock times (`+1d` past midnight)
and waits; `metrics` with departure, arrival, waiting and in-vehicle time; `search.connections_scanned`.

Error codes: `no_dataset` (503), `unknown_station` (404), `station_not_served`, `unreachable`,
`transfer_limit`, `no_service_on_date` (with `suggested_date`), `no_scheduled_journey`,
`schedule_unsupported`, `search_timeout` (504), `validation_error` (422), `rate_limited` (429),
`unauthorized` / `forbidden` / `admin_disabled`, `import_failed` (with `dataset_id` and report).
