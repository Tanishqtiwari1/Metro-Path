/// <reference lib="webworker" />
// Runs MetroMind's Python backend inside the browser with Pyodide (static GitHub Pages build).
// Messages in:  {type:'init', base, saved} | {type:'request', id, method, url, headers, body}
// Messages out: {type:'progress', stage, bytes} | {type:'ready', info} | {type:'failed', error}
//               {type:'response', id, status, headers, body} | {type:'persist', saved}

const PYODIDE_VERSION = '0.29.3'
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

/* eslint-disable @typescript-eslint/no-explicit-any */
let pyodide: any = null
let handle: any = null
let dumpSaved: any = null
let ready: Promise<void> | null = null

const post = (msg: unknown) => (self as unknown as Worker).postMessage(msg)

// Count bytes of every download (Pyodide runtime, packages, wheels, data) to report real progress.
let bytesLoaded = 0
let stage = 'Starting…'
const report = () => post({ type: 'progress', stage, bytes: bytesLoaded })
const realFetch = self.fetch.bind(self)
self.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await realFetch(input, init)
  if (!res.body) return res
  let last = 0
  const counted = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        bytesLoaded += chunk.byteLength
        if (bytesLoaded - last > 256_000) {
          last = bytesLoaded
          report()
        }
        ctrl.enqueue(chunk)
      },
    }),
  )
  return new Response(counted, { status: res.status, statusText: res.statusText, headers: res.headers })
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

async function init(base: string, saved: string) {
  const sb = `${base}static-backend/`
  stage = 'Downloading the Python runtime…'
  report()
  // Site files download in parallel with the runtime.
  const manifestP = fetch(`${sb}manifest.json`).then((r) => {
    if (!r.ok) throw new Error('Dataset manifest missing from this build.')
    return r.text()
  })
  const filesP = Promise.all([fetchBytes(`${sb}app.zip`), fetchBytes(`${sb}dataset.zip`)])
  const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`)
  pyodide = await loadPyodide({ indexURL: PYODIDE_URL })

  stage = 'Loading scientific packages (pandas, SQLAlchemy, FastAPI)…'
  report()
  await pyodide.loadPackage(['numpy', 'pandas', 'sqlalchemy', 'sqlite3', 'pydantic', 'fastapi', 'tzdata', 'micropip'], {
    messageCallback: () => {},
  })
  // Pure-Python wheels served by this site (no PyPI round-trips); their dependencies were resolved at build time.
  const manifest = await manifestP
  const wheels: string[] = JSON.parse(manifest).wheels ?? []
  const micropip = pyodide.pyimport('micropip')
  await micropip.install.callKwargs(pyodide.toPy(wheels.map((w) => new URL(`${sb}wheels/${w}`, self.location.href).href)), {
    deps: false,
  })

  stage = 'Validating the feed and building the network graph…'
  report()
  const [appZip, dataZip] = await filesP
  pyodide.unpackArchive(appZip, 'zip', { extractDir: '/home/pyodide' })
  pyodide.globals.set('DATASET_ZIP', dataZip)
  pyodide.globals.set('MANIFEST', manifest)
  pyodide.globals.set('SAVED', saved)
  const info = await pyodide.runPythonAsync(`
import os, sys, json
sys.path.insert(0, "/home/pyodide")
os.environ.update({
    "METROMIND_DATABASE_URL": "sqlite:///:memory:",
    "METROMIND_AUTO_MIGRATE": "false",
    "METROMIND_RATE_LIMIT_PER_MINUTE": "0",
    "METROMIND_ENVIRONMENT": "static",
})
from app import inbrowser
result = inbrowser.boot(bytes(DATASET_ZIP.to_py()), MANIFEST)
inbrowser.load_saved(SAVED)
json.dumps(result)
`)
  const ib = pyodide.pyimport('app.inbrowser')
  handle = ib.handle
  dumpSaved = ib.dump_saved
  post({ type: 'ready', info: JSON.parse(info) })
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data
  if (msg.type === 'init') {
    ready ??= init(msg.base, msg.saved ?? '[]').catch((err) => {
      post({ type: 'failed', error: err instanceof Error ? err.message : String(err) })
      ready = null
      throw err
    })
    return
  }
  if (msg.type === 'request') {
    try {
      await ready
      const out = handle(msg.method, msg.url, JSON.stringify(msg.headers ?? {}), msg.body ?? null).toJs({
        dict_converter: Object.fromEntries,
      })
      post({ type: 'response', id: msg.id, ...out })
      const mutating = msg.method !== 'GET' && (msg.url.startsWith('/api/me/') || msg.url.startsWith('/api/routes/plan'))
      if (mutating && out.status < 400) post({ type: 'persist', saved: dumpSaved() })
    } catch (err) {
      post({
        type: 'response',
        id: msg.id,
        status: 503,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: { code: 'engine_unavailable', message: `The in-browser engine failed to start: ${err instanceof Error ? err.message : err}`, details: {} } }),
      })
    }
  }
}
