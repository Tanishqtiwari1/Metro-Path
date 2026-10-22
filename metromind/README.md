# MetroMind — Intelligent Transit Route Optimizer

MetroMind turns the original `metro_path_search.py` (Greedy Best-First Search on a hand-written
14-station toy map) into a full web application driven by **real GTFS transit data**:

- **Route planner**: fastest, fewest-change, fewest-stop, shortest-distance or balanced routes, with
  alternatives, transfer limits, shareable links, CSV/JSON export, favourites and history.
- **Timetable-aware journeys** (Connection Scan Algorithm) for a chosen date and time, using the feed's
  service calendar, including trips that run past 24:00.
- **Algorithm lab**: step through *recorded* execution traces of GBFS, BFS, Dijkstra and A*. It shows the
  frontier (priority queue), current node, g/h/f values and the explored set on a live map.
- **Comparison lab**: every algorithm runs on the same inputs and is costed by the same evaluator. You
  get repeated timings, expansions, peak Python heap and optimality gaps.
- **Network explorer**: stations, lines, neighbours, first and last scheduled departures, nearby-station
  search.
- **Analytics**: degree distribution, betweenness, interchanges, connected components, path
  statistics and a seeded algorithm benchmark.
- **Dataset administration**: validated GTFS upload, import reports and logs, versions, rollback and
  graph rebuild.

Nothing operational is hard-coded: stations, lines, connections, colours, timings and calendars all
come from the imported feed. When the data lacks something (fares, transfer times, accessibility,
real-time information), the app says so instead of inventing it.

**Live demo:** <https://tanishqtiwari1.github.io/Metro-Path/>. The first visit downloads about 30 MB
(the Python runtime) and takes 10–30 s to start; later visits are faster.

[Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Data & licensing](docs/DATA.md)

---

## Repository layout

```
metromind/
├── backend/                 FastAPI + SQLAlchemy + NetworkX + Pandas
│   ├── app/
│   │   ├── ingestion/       archive.py (safe ZIP), parser.py (validation), importer.py (persistence)
│   │   ├── graph/           network.py (station graph, route patterns, connections), geo, colours
│   │   ├── algorithms/      gbfs.py, bfs.py, dijkstra.py, astar.py, csa.py, base.py (traces)
│   │   ├── routing/         spaces.py (objectives & state spaces), evaluate.py, planner.py
│   │   ├── api/             REST routers
│   │   ├── analytics.py     network metrics
│   │   ├── models.py        normalised schema (per dataset version)
│   │   └── main.py / cli.py
│   ├── alembic/             migrations
│   └── tests/               pytest (synthetic GTFS fixtures only)
├── frontend/                React 19 + Vite + TypeScript + Tailwind v4 + Radix/shadcn-style UI
│   └── src/{pages,components,lib}
├── docs/                    architecture, API, data & licensing
├── Dockerfile               single-container build (API serves the built SPA)
└── docker-compose.yml       PostgreSQL + app
```

The original script (`../metro_path_search.py`) is left untouched. Its GBFS loop lives on in
`backend/app/algorithms/gbfs.py`, refactored to run on a pluggable search space built from GTFS data.

---

## Quick start (macOS / Linux, local development)

Requirements: **Python 3.12+**, **Node 20+**. PostgreSQL is optional locally (SQLite is the default).

```bash
cd metromind/backend
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
```

### 1. Get the dataset

The official source is the Delhi Open Transit Data portal:
<https://otd.delhi.gov.in/data/staticDMRC/>. Click **Download Data**, state your usage and purpose and
accept the portal's Terms & Conditions, then save the ZIP into `backend/data/sources/`.
See [docs/DATA.md](docs/DATA.md) for terms, attribution and the mirror used during development.

### 2. Import it

```bash
cd metromind/backend
.venv/bin/python -m app.cli import data/sources/<your-file>.zip --label "DMRC static GTFS"
.venv/bin/python -m app.cli list
```

The import validates the archive and every table, builds the graph, and only then commits. A failed
import is recorded with its report and never replaces the active dataset. Migrations run automatically.

### 3. Run

```bash
# terminal 1 – API on :8000 (docs at http://localhost:8000/api/docs)
cd metromind/backend
METROMIND_ADMIN_TOKEN=change-me .venv/bin/uvicorn app.main:app --reload --port 8000

# terminal 2 – web app on :5173 (proxies /api to :8000)
cd metromind/frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Use the admin token on the **Dataset** page to upload, roll back or
rebuild.

> If `npm run dev` starts but never prints "ready" (some sandboxed or network filesystems block native
> file watching), run `VITE_WATCH_POLLING=true npm run dev`.

### Tests

```bash
cd metromind/backend && .venv/bin/python -m pytest        # 95 tests: ingestion, algorithms, routing, CSA, API, persistence
cd metromind/frontend && npm test                         # share-link validation, station search, empty/error states
cd metromind/frontend && npm run build                    # type-check + production build
```

---

## Production (Docker + PostgreSQL)

```bash
cd metromind
cp .env.example .env           # set POSTGRES_PASSWORD and METROMIND_ADMIN_TOKEN
docker compose up -d --build
# import a feed placed in backend/data/sources/
docker compose exec app python -m app.cli import /data/sources/<file>.zip --label "DMRC static GTFS"
```

The single image builds the frontend and serves it from FastAPI at `/`, with the API under `/api`. No
localhost URLs are baked in: the SPA calls the same origin unless `VITE_API_BASE_URL` is set at build
time. For a separately hosted frontend, set `VITE_API_BASE_URL` and `METROMIND_CORS_ORIGINS`.

Environment variables are documented in [`.env.example`](.env.example) and
[`frontend/.env.example`](frontend/.env.example).

---

## Static edition (GitHub Pages)

GitHub Pages can only host static files, so the Pages build runs the **real Python backend inside the
browser** with [Pyodide](https://pyodide.org) (Python compiled to WebAssembly):

- `frontend/scripts/bundle_backend.py` zips `backend/app` and the GTFS feed, recording its SHA-256.
- A web worker (`frontend/src/workers/py.worker.ts`) loads Pyodide, pandas, SQLAlchemy and FastAPI,
  then calls `app/inbrowser.py`. That module validates the feed and builds the network exactly as an
  import does, then dispatches `/api/...` calls to the same handler functions the server uses.
  Algorithms and results are therefore identical to the server's.
- Routing uses hash URLs (`/#/plan?...`), so share links work without server rewrites.
- Saved routes and history are kept in the visitor's browser. Dataset upload and rollback need the full
  server and are disabled in the static edition.

The workflow `.github/workflows/pages.yml` rebuilds and deploys on every push to `main`. It downloads
the feed from `GTFS_URL` and refuses to build unless it matches `GTFS_SHA256`; both can be overridden
with repository variables. To build locally:

```bash
cd metromind/frontend
python3 scripts/bundle_backend.py --dataset ../backend/data/sources/<feed>.zip --label "DMRC static GTFS"
VITE_STATIC=true VITE_BASE=/Metro-Path/ npm run build
```

---

## How routing works (short version)

| Algorithm | Space | Optimal? | Notes |
|---|---|---|---|
| Greedy Best-First | station graph | No | Priority = straight-line km to destination (the original project's heuristic). |
| BFS | station graph | Fewest hops only | Hops ≠ time. |
| Dijkstra | objective's space | Yes | Non-negative weights; supports lexicographic costs. |
| A* | objective's space | Yes (admissible + consistent h) | h = straight-line metres × the network's minimum cost per metre. |
| Connection Scan | timetable | Earliest arrival | Service calendar, exceptions, after-midnight trips, minimum connection time. |

Objectives: **time** (scheduled ride time + an *assumed*, configurable allowance per train change),
**transfers** (lexicographic: changes, then time), **distance** (track distance from
`shape_dist_traveled`, with labelled straight-line estimates where missing), **stops**, and **balanced**
(minutes + configurable minutes per change and per stop). BFS and GBFS ignore costs by definition.
Their paths are costed afterwards, so comparisons stay fair. **Auto** mode picks CSA when a departure
time is given, BFS for hop count, otherwise A* (or Dijkstra without coordinates), and explains why.

Details, complexity and the graph model: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Known limitations (with the DMRC August 2023 feed)

- **The service calendar ended on 2025-12-31.** Timetable routing works only for dates in the feed's
  window; the UI offers the closest valid date with the same weekday. Static routing still uses the
  scheduled stop-to-stop times.
- **No Sunday trips, and only a handful of Saturday trips** in the feed. Those days return "no
  service" rather than invented timetables.
- **No `transfers.txt`.** Interchange walking time is unknown, so a configurable allowance (default
  300 s static, 120 s minimum connection in timetable mode) is used and labelled in every result.
- **Disconnected component.** The Aqua line (Noida–Greater Noida, 21 stations) has no transfer link to
  the rest of the network in the feed, so trips between them are reported as unreachable.
- **No route colours.** Colours are inferred from line names (e.g. "BLUE_…") and marked as inferred.
  Lines whose names contain no colour word (e.g. Rapid Metro) get a placeholder colour.
- **No fares, accessibility or real-time data** in the feed, so none are shown.
- Distances: 23 of 548 segments lack a usable `shape_dist_traveled`, so they use a labelled
  straight-line estimate.
- Inter-station walking transfers from a `transfers.txt` are listed on station pages but not routed.
  Same-station `min_transfer_time` values are honoured. Stops sharing a `parent_station` are merged.
- Rate limiting is in-memory (single process). Put a shared limiter at the proxy for multi-replica
  deployments.
- Frontend tests are component-level (Vitest). End-to-end flows were verified manually in a browser
  against the real feed, not with an automated browser suite.

## Troubleshooting

| Symptom | Fix |
|---|---|
| UI says "No transit dataset is active" | Import a GTFS ZIP (CLI or Dataset page). |
| "Date outside the timetable" | The feed's calendar doesn't cover that date; use the suggested date. |
| "Admin actions are disabled" | Set `METROMIND_ADMIN_TOKEN` and restart the API. |
| `npm run dev` hangs silently | `VITE_WATCH_POLLING=true npm run dev`. |
| "Refresh from source URL" fails | The official portal needs a form; set `METROMIND_DATASET_SOURCE_URL` to a direct ZIP URL, or upload instead. |
| Upload rejected | Read the import report on the Dataset page: it lists the failing file, column or reference. |

## Data source & attribution

Transit data: **Delhi Metro Rail Corporation static GTFS**, published on Delhi Open Transit Data by the
Department of Transport, GNCTD, with IIIT-Delhi (<https://otd.delhi.gov.in/>). Material is reproduced
under the portal's Terms & Conditions, with the source acknowledged. MetroMind is not endorsed by DMRC
or the Department of Transport. Map tiles © OpenStreetMap contributors. See [docs/DATA.md](docs/DATA.md).
