import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, PageHeader, Segmented, Switch } from '@/components/ui'
import { api } from '@/lib/api'
import { getClientId, resetClientId } from '@/lib/clientId'
import { ALGO_SHORT, OBJECTIVE_LABELS } from '@/lib/format'
import { usePrefs, type Theme } from '@/lib/prefs'
import { useMeta } from '@/lib/queries'
import type { AlgorithmChoice, Objective } from '@/lib/types'

function Row({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Label htmlFor={htmlFor} className="text-sm text-foreground">
          {label}
        </Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="sm:w-64">{children}</div>
    </div>
  )
}

export default function SettingsPage() {
  const { prefs, setPrefs, reset } = usePrefs()
  const meta = useMeta()
  const qc = useQueryClient()
  const [clientId, setClientId] = useState(getClientId)
  const clear = useMutation({ mutationFn: api.clearHistory, onSuccess: () => qc.invalidateQueries({ queryKey: ['saved'] }) })
  const serverPenalty = meta.data?.defaults.transfer_penalty_s
  const serverMinTransfer = meta.data?.defaults.min_transfer_s

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <PageHeader title="Settings" description="Preferences are stored in this browser only." actions={<Button variant="outline" onClick={reset}>Restore defaults</Button>} />

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label="Theme">
            <Segmented<Theme>
              label="Theme"
              value={prefs.theme}
              onChange={(theme) => setPrefs({ theme })}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'system', label: 'System' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </Row>
          <Row label="Lab playback speed" hint="Trace events per second in the algorithm lab." htmlFor="speed">
            <Input id="speed" type="number" min={1} max={120} value={prefs.traceSpeed} onChange={(e) => setPrefs({ traceSpeed: Math.max(1, Math.min(120, Number(e.target.value) || 1)) })} />
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Routing defaults</CardTitle>
          <CardDescription>Used to pre-fill the planner. Each search can still override them.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label="Default objective" htmlFor="dobj">
            <NativeSelect id="dobj" value={prefs.objective} onChange={(e) => setPrefs({ objective: e.target.value as Objective })}>
              {Object.entries(OBJECTIVE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </Row>
          <Row label="Default algorithm" htmlFor="dalgo">
            <NativeSelect id="dalgo" value={prefs.algorithm} onChange={(e) => setPrefs({ algorithm: e.target.value as AlgorithmChoice })}>
              {(['auto', 'astar', 'dijkstra', 'bfs', 'gbfs'] as const).map((a) => (
                <option key={a} value={a}>
                  {ALGO_SHORT[a]}
                </option>
              ))}
            </NativeSelect>
          </Row>
          <Row
            label="Change allowance (seconds)"
            hint={`Assumed time per train change in static routing. Empty = server default${serverPenalty != null ? ` (${serverPenalty}s)` : ''}.`}
            htmlFor="pen"
          >
            <Input
              id="pen"
              type="number"
              min={0}
              max={3600}
              placeholder={serverPenalty != null ? String(serverPenalty) : ''}
              value={prefs.transferPenaltyS ?? ''}
              onChange={(e) => setPrefs({ transferPenaltyS: e.target.value === '' ? null : Math.max(0, Math.min(3600, Number(e.target.value))) })}
            />
          </Row>
          <Row
            label="Minimum connection time (seconds)"
            hint={`For timetable routing when changing trains. Empty = server default${serverMinTransfer != null ? ` (${serverMinTransfer}s)` : ''}.`}
            htmlFor="mct"
          >
            <Input
              id="mct"
              type="number"
              min={0}
              max={1800}
              placeholder={serverMinTransfer != null ? String(serverMinTransfer) : ''}
              value={prefs.minTransferS ?? ''}
              onChange={(e) => setPrefs({ minTransferS: e.target.value === '' ? null : Math.max(0, Math.min(1800, Number(e.target.value))) })}
            />
          </Row>
          <Row label="Alternatives to request" htmlFor="nalt">
            <NativeSelect id="nalt" value={prefs.alternatives} onChange={(e) => setPrefs({ alternatives: Number(e.target.value) })}>
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </NativeSelect>
          </Row>
          <Row label="Balanced objective weights" hint="Minutes added per change and per stop.">
            <div className="grid grid-cols-2 gap-2">
              <Input aria-label="Minutes per change" type="number" min={0} max={120} step={0.5} value={prefs.wTransferMin} onChange={(e) => setPrefs({ wTransferMin: Number(e.target.value) })} />
              <Input aria-label="Minutes per stop" type="number" min={0} max={30} step={0.1} value={prefs.wStopMin} onChange={(e) => setPrefs({ wStopMin: Number(e.target.value) })} />
            </div>
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Privacy</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <Row label="Keep search history" hint="Recent searches are stored on the server under an anonymous id for this browser.">
            <Switch checked={prefs.recordHistory} onCheckedChange={(v) => setPrefs({ recordHistory: v })} aria-label="Keep search history" />
          </Row>
          <Row label="Clear search history">
            <Button variant="outline" onClick={() => clear.mutate()} loading={clear.isPending}>
              {clear.isSuccess ? <Check /> : null} {clear.isSuccess ? 'Cleared' : 'Clear history'}
            </Button>
          </Row>
          <Row label="Anonymous browser id" hint="Resetting it detaches this browser from its saved routes and history.">
            <div className="flex gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-[11px]" title={clientId}>
                {clientId}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setClientId(resetClientId())
                  qc.invalidateQueries({ queryKey: ['saved'] })
                }}
              >
                Reset
              </Button>
            </div>
          </Row>
        </CardContent>
      </Card>
    </div>
  )
}
