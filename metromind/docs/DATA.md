# Data, sources and licensing

## Official source

- Portal: Delhi Open Transit Data (OTD), Department of Transport, GNCTD, with IIIT-Delhi.
- DMRC static GTFS: <https://otd.delhi.gov.in/data/staticDMRC/> (portal shows "Last Updated: Aug. 10, 2023").
- GTFS reference: <https://gtfs.org/documentation/schedule/reference/>.

Downloading requires a short declaration (usage type, purpose, name) and acceptance of the portal's
[Terms & Conditions](https://otd.delhi.gov.in/static/assets/terms-and-conditions.pdf). Relevant points:

- §6: users must state the content, intent, manner and time frame of use and their identity.
- §22: material may be reproduced free of charge if it is reproduced accurately, is not used in a
  misleading context, and the source is prominently acknowledged.
- §8: data must not be used to track or profile individuals.

MetroMind shows the dataset label, source and attribution on the Dataset page and in every route
result, and never alters the imported records (normalised search keys are stored *alongside* the
original names).

Because of the declaration form, MetroMind cannot download the feed automatically from the official
portal. Administrators download it there and upload it, or set `METROMIND_DATASET_SOURCE_URL` to a
direct ZIP URL they are permitted to use.

## Copy used during development

On 2026-10-22 the official form was submitted (non-commercial / academia), but the portal's server
returned **HTTP 404** for the archive. For development and verification, the unmodified official
archive was taken from a public repository that redistributes it with attribution:

- `https://raw.githubusercontent.com/nilesh0199/MetroMarg-GraphHacks-2026/main/dmrc_gtfs.zip`
- SHA-256 `bd184a7e13907a223032b3b7886babe52ac16b6149f8404f508712b87492fc1b`
- Files dated 2023-03-28 / 2023-08-10; 262 stops, 36 routes, 5,438 trips, 128,434 stop times,
  6,643 shape points; calendar 2019-01-01 → 2025-12-31.

The portal's summary lists higher trip and stop-time counts (17,997 and 411,686) than this copy. The
difference was not investigated further: if you obtain the archive from the portal directly, prefer it
and re-import (the app needs no code changes). The URL and hash are recorded with the dataset version.

Large datasets are **not** committed to Git (`backend/data/sources/*.zip` is ignored).

The GitHub Pages edition downloads this same archive at build time (checksum-verified) and serves it
unmodified alongside the site, so visitors' browsers can load it. This relies on §22 of the portal's
terms (accurate reproduction with the source acknowledged). The site credits the source on the Dataset
page and in every route result.

## What the feed does and does not contain

| Data | Present | How MetroMind uses it |
|---|---|---|
| stops (with coordinates) | yes | stations, map, heuristics, nearby search |
| routes / trips / stop_times | yes | edges, per-route stop-to-stop times, timetable connections |
| calendar | yes (weekday/saturday/sunday; Sunday has no trips) | service-day selection, validity window |
| calendar_dates | no | exceptions supported when present |
| shapes | yes | map geometry, segment slicing; `shape_dist_traveled` for distances |
| transfers | no | assumed, configurable allowance (always labelled) |
| route_color | no | inferred from line name or placeholder (labelled) |
| fares | no | not shown |
| accessibility | no | "no accessibility information" shown; no claims made |
| real-time | no | none shown |

## Map tiles

Default tiles: OpenStreetMap standard tiles (© OpenStreetMap contributors, ODbL). Respect the
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/). For production traffic,
configure your own provider via `VITE_TILE_URL` and `VITE_TILE_ATTRIBUTION`.
