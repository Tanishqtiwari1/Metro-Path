export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

export function fmtDistance(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return '—'
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`
  if (ms < 100) return `${ms.toFixed(2)} ms`
  return `${ms.toFixed(0)} ms`
}

export function fmtNumber(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

export function fmtCost(c: number | number[] | null | undefined, unit?: string): string {
  if (c == null) return '—'
  if (Array.isArray(c)) return `${c[0]} change${c[0] === 1 ? '' : 's'}, ${fmtDuration(c[1])}`
  if (unit === 'seconds') return fmtDuration(c)
  if (unit === 'metres') return fmtDistance(c)
  if (unit === 'hops') return `${c} stops`
  if (unit === 'generalised minutes') return `${c.toFixed(1)} gen. min`
  return String(Math.round(c * 1000) / 1000)
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: iso.length > 10 ? 'short' : undefined })
}

export const OBJECTIVE_LABELS: Record<string, string> = {
  time: 'Fastest',
  transfers: 'Fewest changes',
  distance: 'Shortest distance',
  stops: 'Fewest stops',
  balanced: 'Balanced',
}

export const ALGO_SHORT: Record<string, string> = {
  auto: 'Auto',
  gbfs: 'Greedy BFS',
  bfs: 'BFS',
  dijkstra: 'Dijkstra',
  astar: 'A*',
  csa: 'Connection Scan',
}

export function hex(color: string): string {
  return color.startsWith('#') ? color : `#${color}`
}

/** Readable text colour (black/white) for a background hex. */
export function onColor(color: string): string {
  const c = hex(color).slice(1)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
  const lum = [r, g, b].map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  const L = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2]
  return L > 0.4 ? '#111827' : '#ffffff'
}

// Categorical series colours for the four search algorithms (presentation only).
export const ALGO_COLORS: Record<'gbfs' | 'bfs' | 'dijkstra' | 'astar', string> = {
  gbfs: '#d97706',
  bfs: '#7c3aed',
  dijkstra: '#2563eb',
  astar: '#0f766e',
}
