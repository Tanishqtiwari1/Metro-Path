// Bridge between the API client and the Pyodide worker (static build only).

export const STATIC_MODE = import.meta.env.VITE_STATIC === 'true'

export type EngineState = {
  status: 'idle' | 'booting' | 'ready' | 'failed'
  stage?: string
  error?: string
  bytes?: number
  startedAt?: number
}

const SAVED_KEY = 'metromind.savedRoutes'
let worker: Worker | null = null
let seq = 0
const pending = new Map<number, (r: Response) => void>()
let state: EngineState = { status: 'idle' }
// Precomputed (at build time, by the same backend) answers for a few read-only endpoints, shown
// instantly while the engine boots. Once the engine is ready every request is answered live.
let snapshots: Promise<Record<string, string>> | null = null
const listeners = new Set<(s: EngineState) => void>()

function setState(s: EngineState) {
  state = s
  listeners.forEach((l) => l(s))
}

export function subscribeEngine(fn: (s: EngineState) => void): () => void {
  listeners.add(fn)
  fn(state)
  return () => listeners.delete(fn)
}

export function startEngine() {
  if (worker && state.status !== 'failed') return
  worker?.terminate()
  worker = new Worker(new URL('../workers/py.worker.ts', import.meta.url), { type: 'module' })
  const startedAt = Date.now()
  setState({ status: 'booting', stage: 'Starting…', bytes: 0, startedAt })
  snapshots ??= fetch(`${import.meta.env.BASE_URL}static-backend/snapshots.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data
    if (m.type === 'progress') setState({ status: 'booting', stage: m.stage, bytes: m.bytes, startedAt })
    else if (m.type === 'ready') setState({ status: 'ready' })
    else if (m.type === 'failed') setState({ status: 'failed', error: m.error })
    else if (m.type === 'persist') {
      try {
        localStorage.setItem(SAVED_KEY, m.saved)
      } catch {
        /* storage unavailable: saved routes last for this tab only */
      }
    } else if (m.type === 'response') {
      const resolve = pending.get(m.id)
      pending.delete(m.id)
      const noBody = m.status === 204 || !m.body
      resolve?.(new Response(noBody ? null : m.body, { status: m.status, headers: m.headers }))
    }
  }
  worker.onerror = (e) => setState({ status: 'failed', error: e.message || 'The in-browser engine crashed.' })
  let saved = '[]'
  try {
    saved = localStorage.getItem(SAVED_KEY) ?? '[]'
  } catch {
    /* ignore */
  }
  worker.postMessage({ type: 'init', base: import.meta.env.BASE_URL, saved })
}

export function inBrowserFetch(path: string, init: RequestInit): Promise<Response> {
  startEngine()
  const id = ++seq
  const headers: Record<string, string> = {}
  new Headers(init.headers).forEach((v, k) => (headers[k] = v))
  if (init.body instanceof FormData) {
    return Promise.resolve(
      new Response(
        JSON.stringify({ error: { code: 'admin_disabled', message: 'Uploads are unavailable in the static demo.', details: {} } }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      ),
    )
  }
  if (state.status !== 'ready' && (init.method ?? 'GET') === 'GET' && snapshots) {
    return snapshots.then((snaps) => {
      const body = snaps[path]
      if (body === undefined) return send(id, path, init, headers)
      return new Response(path === '/api/meta' ? withCurrentTime(body) : body, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
  }
  return send(id, path, init, headers)
}

/** The snapshot was made at build time; give the planner today's date/time in the feed's timezone. */
function withCurrentTime(body: string): string {
  try {
    const meta = JSON.parse(body)
    const tz = meta.timezone || undefined
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date())
        .map((p) => [p.type, p.value]),
    )
    meta.local_now = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
    return JSON.stringify(meta)
  } catch {
    return body
  }
}

function send(id: number, path: string, init: RequestInit, headers: Record<string, string>): Promise<Response> {
  return new Promise((resolve) => {
    pending.set(id, resolve)
    worker!.postMessage({ type: 'request', id, method: init.method ?? 'GET', url: path, headers, body: init.body ?? null })
  })
}
