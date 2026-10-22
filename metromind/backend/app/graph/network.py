"""In-memory transit network built from a validated feed.

Graph model (documented in docs/ARCHITECTURE.md):

* **Station graph**: a directed simple graph. Node = station (a stop, or its parent
  station when GTFS parent_station is used). A directed edge u->v exists only when at
  least one trip serves u then v consecutively. Each edge keeps a per-route table of
  scheduled stop-to-stop times so line information is never lost when several routes
  share track. Directed because service patterns may be one-way.
* **Route-aware state space** (used for time/transfer objectives): state = (station,
  route_id) while riding, or (station, None) while standing at a station. Riding along a
  route costs its scheduled time; alighting costs a transfer allowance. This is a
  multigraph in effect (parallel route-specific edges between the same stations).
* **Connections** (used for schedule-aware routing): one record per consecutive
  stop-time pair of every trip, for the Connection Scan Algorithm.
"""

import re
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

import pandas as pd

from ..ingestion.parser import Feed
from .colors import FALLBACK_PALETTE, infer_color
from .geo import haversine_m


@dataclass
class Station:
    id: str
    name: str
    normalized: str
    lat: float | None
    lon: float | None
    stop_ids: list[str] = field(default_factory=list)
    routes: set[str] = field(default_factory=set)
    lines: set[str] = field(default_factory=set)
    wheelchair_boarding: int | None = None

    @property
    def has_coords(self) -> bool:
        return self.lat is not None and self.lon is not None


@dataclass
class Line:
    id: str
    name: str
    color: str
    color_source: str  # "feed" | "inferred_from_name" | "fallback_palette"
    route_ids: list[str] = field(default_factory=list)


@dataclass
class RouteInfo:
    id: str
    short_name: str
    long_name: str
    line_id: str
    route_type: int | None
    pattern: list[str] = field(default_factory=list)  # most common station sequence
    shape_id: str | None = None
    trip_count: int = 0


@dataclass
class Edge:
    u: str
    v: str
    route_times: dict[str, float] = field(default_factory=dict)  # route_id -> scheduled seconds
    distance_m: float | None = None
    distance_source: str = "unknown"  # "shape_dist_traveled" | "straight_line_estimate"
    straight_m: float | None = None

    @property
    def routes(self) -> set[str]:
        return set(self.route_times)

    @property
    def min_time(self) -> float | None:
        return min(self.route_times.values()) if self.route_times else None


@dataclass
class Connection:
    dep_stop: str
    arr_stop: str
    dep: int
    arr: int
    trip_id: str
    route_id: str
    service_id: str


class TransitNetwork:
    def __init__(self, feed: Feed, *, line_group_pattern: str, infer_colors: bool):
        self.timezone = feed.timezone
        self.service_start = feed.service_start
        self.service_end = feed.service_end
        self.notes: list[str] = []
        self._build_stations(feed)
        self._build_routes(feed, line_group_pattern, infer_colors)
        self._build_edges_and_connections(feed)
        self._build_services(feed)
        self._build_transfers(feed)
        self._build_shapes(feed)
        self._compute_bounds()

    # ------------------------------------------------------------------ build
    def _build_stations(self, feed: Feed) -> None:
        stops = feed.stops
        self.stop_to_station: dict[str, str] = {}
        self.stations: dict[str, Station] = {}
        for r in stops.itertuples(index=False):
            sid = r.parent_station or r.stop_id
            self.stop_to_station[r.stop_id] = sid
        for r in stops.itertuples(index=False):
            if r.parent_station:
                continue
            lat = None if pd.isna(r.lat) else float(r.lat)
            lon = None if pd.isna(r.lon) else float(r.lon)
            wb = None if pd.isna(r.wheelchair_boarding) else int(r.wheelchair_boarding)
            self.stations[r.stop_id] = Station(r.stop_id, r.display_name, r.name_normalized, lat, lon,
                                               wheelchair_boarding=wb)
        for r in stops.itertuples(index=False):
            st = self.stations.get(self.stop_to_station[r.stop_id])
            if st is not None:
                st.stop_ids.append(r.stop_id)
                if st.lat is None and not pd.isna(r.lat):  # station row without coords: borrow a child's
                    st.lat, st.lon = float(r.lat), float(r.lon)

    def _build_routes(self, feed: Feed, pattern: str, infer_colors: bool) -> None:
        rx = re.compile(pattern) if pattern else None
        self.routes: dict[str, RouteInfo] = {}
        self.lines: dict[str, Line] = {}
        for r in feed.routes.itertuples(index=False):
            long_name = r.route_long_name or ""
            line_name = None
            if rx and long_name:
                m = rx.search(long_name)
                if m and m.group(1).strip():
                    line_name = m.group(1).strip()
            line_name = line_name or r.route_short_name or r.route_long_name or r.route_id
            line_id = re.sub(r"[^a-z0-9]+", "-", line_name.lower()).strip("-") or r.route_id
            rtype = None if pd.isna(r.route_type) else int(r.route_type)
            self.routes[r.route_id] = RouteInfo(r.route_id, r.route_short_name, long_name, line_id, rtype)
            line = self.lines.get(line_id)
            if line is None:
                line = self.lines[line_id] = Line(line_id, line_name.title() if line_name.isupper() else line_name,
                                                  "", "")
            line.route_ids.append(r.route_id)
            if r.route_color and not line.color:
                line.color, line.color_source = r.route_color.upper(), "feed"
        for i, line in enumerate(sorted(self.lines.values(), key=lambda ln: ln.id)):
            if line.color:
                continue
            inferred = infer_color(line.name) if infer_colors else None
            if inferred:
                line.color, line.color_source = inferred, "inferred_from_name"
            else:
                line.color, line.color_source = FALLBACK_PALETTE[i % len(FALLBACK_PALETTE)], "fallback_palette"

    def _build_edges_and_connections(self, feed: Feed) -> None:
        trips = feed.trips.set_index("trip_id")
        trip_route = trips["route_id"].to_dict()
        trip_service = trips["service_id"].to_dict()
        trip_shape = trips["shape_id"].to_dict()
        st = feed.stop_times
        times: dict[tuple[str, str, str], list[float]] = defaultdict(list)
        shape_d: dict[tuple[str, str], list[float]] = defaultdict(list)
        patterns: dict[str, Counter] = defaultdict(Counter)
        shapes_used: dict[str, Counter] = defaultdict(Counter)
        self.connections: list[Connection] = []
        bad_hops = 0

        for trip_id, grp in st.groupby("trip_id", sort=False):
            route_id = trip_route.get(trip_id)
            if route_id is None:
                continue
            stations = [self.stop_to_station.get(s) for s in grp["stop_id"]]
            arr = grp["arrival_s"].tolist()
            dep = grp["departure_s"].tolist()
            sd = grp["shape_dist_traveled"].tolist()
            seq = tuple(stations)
            patterns[route_id][seq] += 1
            if trip_shape.get(trip_id):
                shapes_used[route_id][trip_shape[trip_id]] += 1
            for i in range(len(stations) - 1):
                u, v = stations[i], stations[i + 1]
                if u is None or v is None or u == v:
                    continue
                key = (u, v, route_id)
                times.setdefault(key, [])
                a_u, a_v, d_u = arr[i], arr[i + 1], dep[i]
                if pd.notna(a_u) and pd.notna(a_v) and a_v >= a_u and pd.notna(d_u) and a_v >= d_u:
                    # Arrival-to-arrival: includes the dwell at u, so chained edges add up to
                    # scheduled journey time (documented approximation for the static graph).
                    times[key].append(float(a_v - a_u))
                    if a_v > d_u:
                        self.connections.append(Connection(u, v, int(d_u), int(a_v), str(trip_id), route_id,
                                                           trip_service.get(trip_id, "")))
                else:
                    bad_hops += 1
                if pd.notna(sd[i]) and pd.notna(sd[i + 1]) and sd[i + 1] > sd[i]:
                    shape_d[(u, v)].append(float(sd[i + 1] - sd[i]))
        if bad_hops:
            self.notes.append(f"{bad_hops} hop(s) had missing or inconsistent times and carry no duration.")

        self.edges: dict[tuple[str, str], Edge] = {}
        self.adj: dict[str, list[str]] = defaultdict(list)
        self.radj: dict[str, list[str]] = defaultdict(list)
        for (u, v, route_id), vals in times.items():
            e = self.edges.get((u, v))
            if e is None:
                e = self.edges[(u, v)] = Edge(u, v)
                self.adj[u].append(v)
                self.radj[v].append(u)
            if vals:
                e.route_times[route_id] = statistics.median(vals)
            else:
                e.route_times.setdefault(route_id, float("nan"))
        # Drop untimed route entries (NaN) from the time table but keep topology.
        for e in self.edges.values():
            e.route_times = {r: t for r, t in e.route_times.items() if t == t} or e.route_times

        self._assign_distances(shape_d)

        for route_id, counter in patterns.items():
            info = self.routes[route_id]
            info.pattern = list(counter.most_common(1)[0][0])
            info.trip_count = sum(counter.values())
            if shapes_used.get(route_id):
                info.shape_id = shapes_used[route_id].most_common(1)[0][0]
            line = self.lines[info.line_id]
            for seq in counter:
                for s in seq:
                    if s in self.stations:
                        self.stations[s].routes.add(route_id)
                        self.stations[s].lines.add(line.id)
        self.connections.sort(key=lambda c: (c.dep, c.arr))
        self.connection_deps = [c.dep for c in self.connections]
        self.has_overnight_service = bool(self.connections) and self.connections[-1].dep >= 86400
        # Latest departure (as seconds after the *next* midnight) of trips timetabled past 24:00.
        self.overnight_until_s = (self.connections[-1].dep - 86400) if self.has_overnight_service else -1

    def _assign_distances(self, shape_d: dict) -> None:
        """Use shape_dist_traveled when its unit can be established; otherwise fall back to a
        clearly labelled straight-line estimate. GTFS does not fix the unit, so it is inferred
        from the median ratio to the straight-line distance."""
        ratios = []
        for e in self.edges.values():
            a, b = self.stations.get(e.u), self.stations.get(e.v)
            if a and b and a.has_coords and b.has_coords:
                e.straight_m = haversine_m(a.lat, a.lon, b.lat, b.lon)
                if shape_d.get((e.u, e.v)) and e.straight_m > 50:
                    ratios.append(statistics.median(shape_d[(e.u, e.v)]) / e.straight_m)
        scale = None
        if ratios:
            r = statistics.median(ratios)
            if 0.8 <= r <= 3:
                scale, unit = 1.0, "metres"
            elif 0.0008 <= r <= 0.003:
                scale, unit = 1000.0, "kilometres"
            else:
                unit = "unknown"
            self.notes.append(f"shape_dist_traveled interpreted as {unit} (median ratio to straight-line "
                              f"distance {r:.3f}).")
        self.distance_unit_scale = scale
        fallback = 0
        for e in self.edges.values():
            vals = shape_d.get((e.u, e.v))
            d = statistics.median(vals) * scale if (vals and scale) else None
            # Track distance cannot be shorter than the straight line between stations.
            if d is not None and e.straight_m is not None and d < e.straight_m * 0.95:
                d = None
            if d is not None:
                e.distance_m, e.distance_source = d, "shape_dist_traveled"
            elif e.straight_m is not None:
                e.distance_m, e.distance_source = e.straight_m, "straight_line_estimate"
                fallback += 1
        if fallback:
            self.notes.append(f"{fallback} edge(s) lack usable track distance and use a straight-line estimate.")

    def _build_services(self, feed: Feed) -> None:
        self.calendars = {r.service_id: (r.days, r.start_date, r.end_date)
                          for r in feed.calendars.itertuples(index=False)}
        self.exceptions: dict[date, dict[str, int]] = defaultdict(dict)
        for r in feed.calendar_dates.itertuples(index=False):
            self.exceptions[r.date][r.service_id] = int(r.exception_type)
        # Services with no trips (e.g. a calendar row for Sunday that no trip uses) give no service.
        self.service_trip_use = dict(Counter(c.service_id for c in self.connections))
        self.schedule_supported = bool(self.connections) and bool(self.calendars or self.exceptions)
        served_days = Counter()
        for sid, (days, _, _) in self.calendars.items():
            if not self.service_trip_use.get(sid):
                continue
            for i, flag in enumerate(days):
                if flag == "1":
                    served_days[i] += self.service_trip_use[sid]
        self.weekday_coverage = {name: served_days[i] for i, name in
                                 enumerate(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])}

    def _build_transfers(self, feed: Feed) -> None:
        self.walk_transfers: dict[str, list[tuple[str, int]]] = defaultdict(list)
        self.min_transfer_at: dict[str, int] = {}
        for r in feed.transfers.itertuples(index=False):
            a, b = self.stop_to_station.get(r.from_stop_id), self.stop_to_station.get(r.to_stop_id)
            if a is None or b is None or r.transfer_type == 3:
                continue
            t = None if pd.isna(r.min_transfer_time) else int(r.min_transfer_time)
            if a == b:
                if t is not None:
                    self.min_transfer_at[a] = t
            else:
                self.walk_transfers[a].append((b, t if t is not None else -1))
        self.has_transfer_data = bool(len(feed.transfers))

    def _build_shapes(self, feed: Feed) -> None:
        self.shapes: dict[str, list[tuple[float, float]]] = {}
        for sid, grp in feed.shapes.groupby("shape_id", sort=False):
            self.shapes[str(sid)] = list(zip(grp["lat"].astype(float), grp["lon"].astype(float)))

    def _compute_bounds(self) -> None:
        coords = [(s.lat, s.lon) for s in self.stations.values() if s.has_coords]
        self.bounds = None
        if coords:
            lats, lons = zip(*coords)
            self.bounds = [[min(lats), min(lons)], [max(lats), max(lons)]]
        # Admissible heuristic factors: the minimum cost per straight-line metre over all edges.
        timed = [(e.min_time, e.straight_m) for e in self.edges.values()
                 if e.min_time and e.straight_m and e.straight_m > 1]
        self.min_s_per_m = min((t / d for t, d in timed), default=0.0)
        dist = [(e.distance_m, e.straight_m) for e in self.edges.values() if e.distance_m and e.straight_m]
        self.min_dist_ratio = min((d / s for d, s in dist if s > 1), default=0.0)
        self.max_edge_straight_m = max((e.straight_m or 0 for e in self.edges.values()), default=0.0)
        self.routable = {s for s in self.stations if self.adj.get(s) or self.radj.get(s)}

    # --------------------------------------------------------------- queries
    def straight_m(self, a: str, b: str) -> float | None:
        sa, sb = self.stations.get(a), self.stations.get(b)
        if not (sa and sb and sa.has_coords and sb.has_coords):
            return None
        return haversine_m(sa.lat, sa.lon, sb.lat, sb.lon)

    def line_of(self, route_id: str) -> Line:
        return self.lines[self.routes[route_id].line_id]

    def active_services(self, day: date) -> set[str]:
        weekday = day.weekday()
        active = {sid for sid, (days, s, e) in self.calendars.items() if s <= day <= e and days[weekday] == "1"}
        for sid, et in self.exceptions.get(day, {}).items():
            if et == 1:
                active.add(sid)
            else:
                active.discard(sid)
        return active

    def nearest_service_date(self, day: date) -> date | None:
        """Closest date inside the validity window with running trips, preferring the same weekday
        (timetables differ by weekday); falls back to any weekday if that weekday never has service."""
        if self.service_start is None or self.service_end is None:
            return None
        anchor = min(max(day, self.service_start), self.service_end)
        for step in (7, 1):
            start = day if step == 7 else anchor
            for delta in range(0, 3700, step):
                for d in (start - timedelta(days=delta), start + timedelta(days=delta)):
                    if self.service_start <= d <= self.service_end and self.has_trips_on(d):
                        return d
        return None

    def has_trips_on(self, day: date) -> bool:
        return any(self.service_trip_use.get(s) for s in self.active_services(day))

    def search_stations(self, query: str, limit: int) -> list[Station]:
        """Rank stations by how well the query matches: exact > prefix > every query word matches a
        name word (either may abbreviate the other, e.g. "sector" vs "Sec") > substring > fuzzy."""
        import difflib

        from ..ingestion.parser import normalize_name
        q = normalize_name(query)
        if not q:
            return sorted(self.stations.values(), key=lambda s: s.name)[:limit]
        q_tokens = q.split()

        def token_hit(qt: str, nt: str) -> bool:
            return nt.startswith(qt) or (len(nt) >= 3 and qt.startswith(nt))

        scored = []
        for s in self.stations.values():
            n = s.normalized
            n_tokens = n.split()
            if n == q or s.id.lower() == query.strip().lower():
                score = 0.0
            elif n.startswith(q):
                score = 1.0
            elif all(any(token_hit(qt, nt) for nt in n_tokens) for qt in q_tokens):
                score = 2.0
            elif q in n:
                score = 3.0
            else:
                ratio = difflib.SequenceMatcher(None, q, n).ratio()
                if ratio < 0.72:
                    continue
                score = 4.0 + (1 - ratio)
            scored.append((score, s.name, s))
        scored.sort(key=lambda x: (x[0], x[1]))
        return [s for *_, s in scored[:limit]]

    def neighbors_of(self, station_id: str) -> list[str]:
        return sorted(set(self.adj.get(station_id, [])) | set(self.radj.get(station_id, [])))

    def route_geometry(self, route_id: str) -> tuple[list[tuple[float, float]], str]:
        info = self.routes[route_id]
        if info.shape_id and info.shape_id in self.shapes:
            return self.shapes[info.shape_id], "shapes.txt"
        pts = [(self.stations[s].lat, self.stations[s].lon) for s in info.pattern
               if s in self.stations and self.stations[s].has_coords]
        return pts, "station_sequence"

    def segment_geometry(self, route_id: str, stations: list[str]) -> list[tuple[float, float]]:
        """Slice a route's shape between two stations; falls back to the station polyline."""
        straight = [(self.stations[s].lat, self.stations[s].lon) for s in stations
                    if s in self.stations and self.stations[s].has_coords]
        info = self.routes.get(route_id)
        if not info or not info.shape_id or info.shape_id not in self.shapes or len(straight) < 2:
            return straight
        shape = self.shapes[info.shape_id]

        def nearest(pt, start):
            best, bi = float("inf"), start
            for i in range(start, len(shape)):
                d = (shape[i][0] - pt[0]) ** 2 + (shape[i][1] - pt[1]) ** 2
                if d < best:
                    best, bi = d, i
            return bi, best

        i0, d0 = nearest(straight[0], 0)
        i1, d1 = nearest(straight[-1], i0)
        # ~300 m tolerance in degrees^2; if stations are not near the shape, don't trust it.
        if i1 <= i0 or max(d0, d1) > (0.003 ** 2):
            return straight
        return shape[i0:i1 + 1]
