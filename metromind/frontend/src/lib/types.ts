// Types mirroring the MetroMind API responses (backend/app/api/*).

export type Objective = 'time' | 'transfers' | 'distance' | 'stops' | 'balanced'
export type SearchAlgorithm = 'gbfs' | 'bfs' | 'dijkstra' | 'astar'
export type Algorithm = SearchAlgorithm | 'csa'
export type AlgorithmChoice = Algorithm | 'auto'

export interface StationSummary {
  id: string
  name: string
  lat: number | null
  lon: number | null
  lines: string[]
  interchange: boolean
  routable: boolean
}

export interface StationPage {
  items: StationSummary[]
  total: number
  limit: number
  offset: number
}

export interface Dataset {
  id: number
  label: string
  source_kind: string
  source_url: string | null
  source_filename: string | null
  attribution: string | null
  sha256: string
  status: 'pending' | 'valid' | 'failed'
  is_active: boolean
  imported_at: string
  activated_at: string | null
  feed_version: string | null
  service_start: string | null
  service_end: string | null
  timezone: string | null
  stats: Record<string, unknown>
}

export interface Issue {
  code: string
  message: string
  count: number
  samples: string[]
}

export interface DatasetDetail extends Dataset {
  report: { errors?: Issue[]; warnings?: Issue[]; info?: Record<string, unknown> }
  logs: { at: string; level: string; message: string }[]
}

export interface AlgorithmInfo {
  id: Algorithm
  name: string
  informed: boolean
  optimal: boolean | string
  complexity: string
  summary: string
}

export interface Meta {
  dataset: Dataset
  freshness: { status: 'current' | 'expiring' | 'expired' | 'future' | 'unknown'; message: string }
  attribution: string | null
  timezone: string | null
  local_now: string
  bounds: [[number, number], [number, number]] | null
  counts: { stations: number; routes: number; lines: number; edges: number; connections: number }
  capabilities: {
    objectives: { id: Objective; supported: boolean; reason: string | null; description: string }[]
    schedule: {
      supported: boolean
      reason: string | null
      service_start: string | null
      service_end: string | null
      trip_hops_by_weekday: Record<string, number>
    }
    transfer_data: boolean
    fares: boolean
    accessibility_data: boolean
    shapes: boolean
    realtime: boolean
  }
  defaults: {
    transfer_penalty_s: number
    min_transfer_s: number
    max_alternatives: number
    w_transfer_min: number
    w_stop_min: number
    benchmark_max_repeats: number
  }
  algorithms: AlgorithmInfo[]
  network_notes: string[]
}

export interface LineInfo {
  id: string
  name: string
  color: string
  color_source: 'feed' | 'inferred_from_name' | 'fallback_palette'
  routes: string[]
}

export interface NetworkMap {
  stations: StationSummary[]
  routes: {
    route_id: string
    line_id: string
    color: string
    short_name: string
    long_name: string
    geometry_source: string
    trips: number
    geometry: [number, number][]
  }[]
  lines: LineInfo[]
  bounds: [[number, number], [number, number]] | null
}

export interface JourneyStation {
  id: string
  name: string
  lat: number | null
  lon: number | null
  role: 'origin' | 'destination' | 'transfer' | 'pass'
}

export interface Ride {
  route_id: string
  route_short_name: string
  route_long_name: string
  line_id: string
  line_name: string
  color: string
  from_station: string
  to_station: string
  stations: string[]
  hops: number
  ride_time_s: number
  distance_m?: number | null
  geometry: [number, number][]
  // schedule mode only
  trip_id?: string
  departure?: string
  arrival?: string
  wait_before_s?: number
}

export interface StaticMetrics {
  stops: number
  stations_visited: number
  transfers: number
  line_changes: number
  in_vehicle_s: number
  transfer_allowance_s: number
  total_time_s: number
  distance_m: number | null
  distance_basis: string[]
  objective: Objective
  objective_cost: number | [number, number] | null
  objective_unit: string
}

export interface ScheduleMetrics {
  departure: string
  arrival: string
  total_time_s: number
  in_vehicle_s: number
  waiting_s: number
  initial_wait_s: number
  transfers: number
  stops: number
  min_transfer_s: number
}

export interface StaticJourney {
  stations: JourneyStation[]
  rides: Ride[]
  transfers_detail: { station: string; seconds: number; source: string }[]
  metrics: StaticMetrics
  constraints_satisfied: boolean
  tradeoff?: string
}

export interface ScheduleJourney {
  mode: 'schedule'
  service_date: string
  requested_departure: string
  stations: JourneyStation[]
  legs: Ride[]
  metrics: ScheduleMetrics
}

export interface TraceEvent {
  i: number
  type: 'expand' | 'discover' | 'update' | 'goal' | 'board' | 'improve'
  node: string
  label?: string
  from?: string
  g?: number | number[]
  h?: number | number[]
  f?: number | number[]
  t?: number
  trip?: string
  route?: string
  frontier_size?: number
  frontier?: { node: string; label: string; priority: number | number[] }[] | null
}

export interface SearchStats {
  algorithm: Algorithm
  algorithm_name: string
  found?: boolean
  runtime_ms: number
  expanded?: number
  generated?: number
  discovered?: number
  max_frontier?: number
  expansion_order?: string[]
  connections_scanned?: number
  arrival_improvements?: number
  trace?: { events: TraceEvent[]; truncated: boolean; max_events: number }
}

export interface PlanBase {
  request: PlanRequest
  algorithm: Algorithm
  selection_reason: string | null
  objective_description: string
  dataset: { id: number; label: string; attribution: string | null; imported_at: string; freshness: Meta['freshness'] }
  assumptions: string[]
  warnings?: string[]
  notes?: string[]
}

export type PlanResponse =
  | (PlanBase & { mode: 'static'; journey: StaticJourney; search: SearchStats | null; alternatives: StaticJourney[] })
  | (PlanBase & { mode: 'schedule'; journey: ScheduleJourney; search: SearchStats; alternatives: [] })

export interface PlanRequest {
  origin: string
  destination: string
  objective: Objective
  algorithm: AlgorithmChoice
  max_transfers?: number | null
  transfer_penalty_s?: number | null
  w_transfer_min?: number
  w_stop_min?: number
  alternatives?: number
  depart_date?: string | null
  depart_time?: string | null
  min_transfer_s?: number | null
  include_trace?: boolean
  record_history?: boolean
}

export interface RunResponse {
  search: SearchStats
  journey: StaticJourney | null
  objective: Objective
  objective_description: string
  space: string
  heuristic: string | null
  algorithm_info: AlgorithmInfo
}

export interface CompareResult {
  algorithm: SearchAlgorithm
  algorithm_name: string
  found: boolean
  journey: StaticJourney | null
  expanded: number
  generated: number
  discovered: number
  max_frontier: number
  timing_ms: { mean: number; median: number; min: number; max: number; stdev: number; runs: number; samples: number[] }
  peak_python_alloc_kb: number
  expansion_order: string[]
  optimality: { status: 'optimal' | 'suboptimal' | 'unknown' | 'no_route'; gap: number | number[] | null; gap_pct: number | null; guaranteed?: boolean }
}

export interface CompareResponse {
  objective: Objective
  objective_description: string
  objective_unit: string
  reference: string
  reference_cost: number | number[] | null
  repeats: number
  results: CompareResult[]
  notes: string[]
}

export interface StationDetail extends StationSummary {
  stop_ids: string[]
  routes: { id: string; short_name: string; long_name: string; line_id: string }[]
  line_details: { id: string; name: string; color: string }[]
  neighbors: {
    id: string
    name: string
    outbound: boolean
    inbound: boolean
    scheduled_time_s: number | null
    distance_m: number | null
    distance_source: string
    lines: string[]
  }[]
  scheduled_departures: {
    route_id: string
    route_long_name: string
    line_id: string
    service_id: string
    departures: number
    first: string
    last: string
  }[]
  transfer_links: { to: string; to_name: string; min_transfer_time_s: number | null }[]
  min_transfer_time_s: number | null
  wheelchair_boarding: number | null
  accessibility_note: string | null
}

export interface NearbyStation extends StationSummary {
  distance_m: number
}

export interface Analytics {
  summary: Record<string, number>
  components: { size: number; sample: string[] }[]
  degree_distribution: { degree: number; stations: number }[]
  top_betweenness: {
    id: string
    name: string
    betweenness: number
    betweenness_time_weighted: number
    closeness_time: number
    degree: number
    lines: string[]
  }[]
  interchanges: { id: string; name: string; lines: string[]; degree: number; betweenness: number }[]
  lines: { id: string; name: string; color: string; color_source: string; routes: number; stations: number; trips: number }[]
  path_statistics: Record<string, number | string>
  hop_time_distribution: { from_min: number; to_min: number; count: number }[]
  betweenness_sampled: boolean
  metric_notes: Record<string, string>
}

export interface Benchmark {
  objective: Objective
  objective_description: string
  pairs: number
  seed: number
  results: {
    algorithm: SearchAlgorithm
    algorithm_name: string
    mean_expanded: number | null
    median_runtime_ms: number | null
    mean_runtime_ms: number | null
    optimal_share: number | null
    mean_gap_pct: number | null
    max_gap_pct: number | null
  }[]
  note: string
}

export interface SavedRoute {
  id: number
  kind: 'favorite' | 'history'
  origin_id: string
  destination_id: string
  origin_name: string
  destination_name: string
  params: Partial<PlanRequest>
  label: string | null
  created_at: string
  dataset_id: number | null
}

export interface ScheduleStatus {
  date: string
  in_validity_window: boolean
  has_service: boolean
  service_start: string | null
  service_end: string | null
  suggested_date?: string | null
  supported: boolean
}
