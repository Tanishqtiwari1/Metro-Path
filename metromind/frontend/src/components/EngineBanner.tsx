import { Cpu, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui'
import { startEngine, STATIC_MODE, subscribeEngine, type EngineState } from '@/lib/inbrowser'

/** Static build only: shows progress while Python boots in the browser, and errors if it fails. */
export function EngineBanner() {
  const [s, setS] = useState<EngineState>({ status: 'idle' })
  useEffect(() => (STATIC_MODE ? subscribeEngine(setS) : undefined), [])
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
  return (
    <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2 border-b bg-info-soft px-4 py-2 text-sm">
      <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
      <span className="font-medium">Starting MetroMind in your browser</span>
      <span className="text-muted-foreground">· {s.stage}</span>
      <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
        <Cpu className="size-3.5" aria-hidden /> First visit downloads ~30 MB (cached afterwards)
      </span>
    </div>
  )
}
