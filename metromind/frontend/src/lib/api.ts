import { getClientId } from './clientId'
import { inBrowserFetch, STATIC_MODE } from './inbrowser'
import type {
  Analytics,
  Benchmark,
  CompareResponse,
  Dataset,
  DatasetDetail,
  Meta,
  NearbyStation,
  NetworkMap,
  Objective,
  PlanRequest,
  PlanResponse,
  RunResponse,
  SavedRoute,
  ScheduleStatus,
  SearchAlgorithm,
  StationDetail,
  StationPage,
} from './types'

// Same-origin by default (served behind the API or via the Vite dev proxy).
const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''

export class ApiError extends Error {
  status: number
  code: string
  details: Record<string, unknown>
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

async function request<T>(path: string, init: RequestInit & { admin?: string | null; raw?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('X-Client-Id', getClientId())
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (init.admin) headers.set('Authorization', `Bearer ${init.admin}`)
  let res: Response
  try {
    res = STATIC_MODE ? await inBrowserFetch(path, { ...init, headers }) : await fetch(`${BASE}${path}`, { ...init, headers })
  } catch {
    throw new ApiError(0, 'network_error', 'Cannot reach the MetroMind API. Is the backend running?')
  }
  if (!res.ok) {
    let body: { error?: { code: string; message: string; details?: Record<string, unknown> } } = {}
    try {
      body = await res.json()
    } catch {
      /* non-JSON error body */
    }
    const e = body.error
    throw new ApiError(res.status, e?.code ?? 'http_error', e?.message ?? `Request failed (${res.status})`, e?.details ?? {})
  }
  if (init.raw) return res as unknown as T
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

const json = (body: unknown) => JSON.stringify(body)

export const api = {
  meta: () => request<Meta>('/api/meta'),
  stations: (q: string, limit = 12, offset = 0, signal?: AbortSignal) =>
    request<StationPage>(`/api/stations?${new URLSearchParams({ q, limit: String(limit), offset: String(offset) })}`, { signal }),
  station: (id: string) => request<StationDetail>(`/api/stations/${encodeURIComponent(id)}`),
  nearby: (lat: number, lon: number, radius_m: number, limit = 15) =>
    request<NearbyStation[]>(
      `/api/stations/nearby?${new URLSearchParams({ lat: String(lat), lon: String(lon), radius_m: String(radius_m), limit: String(limit) })}`,
    ),
  networkMap: () => request<NetworkMap>('/api/network/map'),
  plan: (body: PlanRequest) => request<PlanResponse>('/api/routes/plan', { method: 'POST', body: json(body) }),
  scheduleStatus: (date: string) => request<ScheduleStatus>(`/api/routes/schedule-status?date=${encodeURIComponent(date)}`),
  run: (body: Omit<PlanRequest, 'algorithm'> & { algorithm: SearchAlgorithm; trace?: boolean }) =>
    request<RunResponse>('/api/algorithms/run', { method: 'POST', body: json(body) }),
  compare: (body: Omit<PlanRequest, 'algorithm'> & { algorithms: SearchAlgorithm[]; repeats: number }) =>
    request<CompareResponse>('/api/algorithms/compare', { method: 'POST', body: json(body) }),
  exportRoute: async (body: PlanRequest & { format: 'csv' | 'json' }) => {
    const res = await request<Response>('/api/routes/export', { method: 'POST', body: json(body), raw: true })
    const blob = await res.blob()
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `route.${body.format}`
    return { blob, name }
  },
  analytics: () => request<Analytics>('/api/analytics/network'),
  benchmark: (pairs: number, seed: number, objective: Objective) =>
    request<Benchmark>(`/api/analytics/benchmark?${new URLSearchParams({ pairs: String(pairs), seed: String(seed), objective })}`),
  datasets: () => request<Dataset[]>('/api/datasets'),
  dataset: (id: number) => request<DatasetDetail>(`/api/datasets/${id}`),
  adminCheck: (token: string) => request<{ ok: boolean }>('/api/admin/check', { admin: token }),
  upload: (token: string, file: File, label: string, activate: boolean) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('label', label)
    fd.append('activate', String(activate))
    return request<DatasetDetail>('/api/admin/datasets/upload', { method: 'POST', body: fd, admin: token })
  },
  refresh: (token: string) => request<DatasetDetail>('/api/admin/datasets/refresh', { method: 'POST', admin: token }),
  activate: (token: string, id: number) => request<Dataset>(`/api/admin/datasets/${id}/activate`, { method: 'POST', admin: token }),
  rebuild: (token: string) =>
    request<{ dataset_id: number; stations: number; edges: number; notes: string[] }>('/api/admin/graph/rebuild', {
      method: 'POST',
      admin: token,
    }),
  saved: (kind: 'favorite' | 'history') => request<SavedRoute[]>(`/api/me/saved?kind=${kind}`),
  save: (body: { origin: string; destination: string; params: Partial<PlanRequest>; label?: string | null }) =>
    request<SavedRoute>('/api/me/saved', { method: 'POST', body: json({ kind: 'favorite', ...body }) }),
  deleteSaved: (id: number) => request<void>(`/api/me/saved/${id}`, { method: 'DELETE' }),
  clearHistory: () => request<void>('/api/me/history', { method: 'DELETE' }),
}
