// Bridge between the API client and the Pyodide worker (static build only).

export const STATIC_MODE = import.meta.env.VITE_STATIC === 'true'

export type EngineState = { status: 'idle' | 'booting' | 'ready' | 'failed'; stage?: string; error?: string }

const SAVED_KEY = 'metromind.savedRoutes'
let worker: Worker | null = null
let seq = 0
const pending = new Map<number, (r: Response) => void>()
let state: EngineState = { status: 'idle' }
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
  setState({ status: 'booting', stage: 'Starting…' })
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data
    if (m.type === 'progress') setState({ status: 'booting', stage: m.stage })
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
  return new Promise((resolve) => {
    pending.set(id, resolve)
    worker!.postMessage({ type: 'request', id, method: init.method ?? 'GET', url: path, headers, body: init.body ?? null })
  })
}
