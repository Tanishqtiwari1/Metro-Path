import { Cpu, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui'
import { startEngine, STATIC_MODE, subscribeEngine, type EngineState } from '@/lib/inbrowser'

// Approximate first-visit download (Pyodide runtime + packages + wheels + data), for the progress bar.
const EXPECTED_BYTES = 30_000_000

/** Static build only: progress while Python boots in the browser, and errors if it fails. */
export function EngineBanner() {
  const [s, setS] = useState<EngineState>({ status: 'idle' })
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => (STATIC_MODE ? subscribeEngine(setS) : undefined), [])
  useEffect(() => {
    if (s.status !== 'booting') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [s.status])

  if (!STATIC_MODE || s.status === 'ready' || s.status === 'idle') return null
  if (s.status === 'failed')
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 border-b bg-danger-soft px-4 py-2 text-sm">
        <span className="font-medium text-danger">The in-browser engine could not start.</span>
        <span className="text-muted-foreground">{s.error}</span>
        <Button size="sm" variant="outline" onClick={() => startEngine()}>
          <RefreshCw /> Retry
        </Button>
      </div>
    )

  const mb = (s.bytes ?? 0) / 1e6
  const pct = Math.min(96, Math.round(((s.bytes ?? 0) / EXPECTED_BYTES) * 100))
  const secs = s.startedAt ? Math.max(0, Math.round((now - s.startedAt) / 1000)) : 0
  const slow = secs > 25 && mb / Math.max(secs, 1) < 0.4
  return (
    <div role="status" aria-live="polite" className="relative border-b bg-info-soft">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
          <span className="relative inline-flex size-2 rounded-full bg-primary" />
        </span>
        <span className="font-medium">Starting the routing engine in your browser</span>
        <span className="text-muted-foreground">{s.stage}</span>
        <span className="tabular ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <Cpu className="size-3.5" aria-hidden /> {mb.toFixed(1)} MB · {secs}s
        </span>
        {slow && (
          <span className="w-full text-xs text-muted-foreground">
            Your connection looks slow, but it is still downloading. The map, station list and analytics already work, and
            the next visit will be much faster.
          </span>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-primary/10">
        <div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
