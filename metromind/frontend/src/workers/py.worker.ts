/// <reference lib="webworker" />
// Runs MetroMind's Python backend inside the browser with Pyodide (static GitHub Pages build).
// Messages in:  {type:'init', base, saved} | {type:'request', id, method, url, headers, body}
// Messages out: {type:'progress', stage} | {type:'ready', info} | {type:'failed', error}
//               {type:'response', id, status, headers, body} | {type:'persist', saved}

const PYODIDE_VERSION = '0.29.3'
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

/* eslint-disable @typescript-eslint/no-explicit-any */
let pyodide: any = null
let handle: any = null
let dumpSaved: any = null
let ready: Promise<void> | null = null

const post = (msg: unknown) => (self as unknown as Worker).postMessage(msg)

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

async function init(base: string, saved: string) {
  post({ type: 'progress', stage: 'Downloading the Python runtime…' })
  const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`)
  pyodide = await loadPyodide({ indexURL: PYODIDE_URL })

  post({ type: 'progress', stage: 'Loading scientific packages (pandas, SQLAlchemy, FastAPI)…' })
  await pyodide.loadPackage(['numpy', 'pandas', 'sqlalchemy', 'sqlite3', 'pydantic', 'fastapi', 'tzdata', 'micropip'])
  const micropip = pyodide.pyimport('micropip')
  // Pure-Python wheels from PyPI. networkx comes straight from PyPI without dependencies: Pyodide's own
  // build of it pulls in matplotlib (~15 MB) that MetroMind never uses.
  await micropip.install('networkx==3.5', { deps: false })
  await micropip.install(['pydantic-settings', 'python-multipart'])

  post({ type: 'progress', stage: 'Loading MetroMind and the transit dataset…' })
  const [appZip, dataZip, manifest] = await Promise.all([
    fetchBytes(`${base}static-backend/app.zip`),
    fetchBytes(`${base}static-backend/dataset.zip`),
    fetch(`${base}static-backend/manifest.json`).then((r) => {
      if (!r.ok) throw new Error('Dataset manifest missing from this build.')
      return r.text()
    }),
  ])
  pyodide.unpackArchive(appZip, 'zip', { extractDir: '/home/pyodide' })

  post({ type: 'progress', stage: 'Validating the feed and building the network graph…' })
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
