import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, CloudDownload, Hammer, KeyRound, LockOpen, RotateCcw, Upload } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Badge, Button, Callout, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Input, Label, PageHeader, Skeleton, Switch } from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import { STATIC_MODE } from '@/lib/inbrowser'
import { fmtDate, fmtNumber } from '@/lib/format'
import { useMeta } from '@/lib/queries'
import type { Dataset, DatasetDetail, Issue } from '@/lib/types'
import { cn } from '@/lib/utils'

// The admin token lives only for this browser tab (sessionStorage), never in localStorage.
const TOKEN_KEY = 'metromind.adminToken'
function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

function IssueList({ title, items, tone }: { title: string; items: Issue[]; tone: 'danger' | 'warning' }) {
  if (!items.length) return null
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title} ({items.length})
      </h4>
      <ul className="space-y-1.5">
        {items.map((w, i) => (
          <li key={i} className={cn('rounded-md p-2 text-xs', tone === 'danger' ? 'bg-danger-soft' : 'bg-warning-soft')}>
            <div className="flex flex-wrap items-center gap-1.5">
              <code className="font-mono font-medium">{w.code}</code>
              <Badge tone="outline">{fmtNumber(w.count)}</Badge>
            </div>
            <p className="mt-0.5 text-muted-foreground">{w.message}</p>
            {w.samples.length > 0 && <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">e.g. {w.samples.join(', ')}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function DatasetReport({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['dataset', id], queryFn: () => api.dataset(id) })
  if (q.isLoading) return <Skeleton className="h-32" />
  if (q.error || !q.data) return <Callout tone="danger">{(q.error as Error)?.message}</Callout>
  const d: DatasetDetail = q.data
  const info = (d.report.info ?? {}) as Record<string, unknown>
  const graph = (info.graph ?? {}) as Record<string, unknown>
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <IssueList title="Errors" items={d.report.errors ?? []} tone="danger" />
        <IssueList title="Warnings" items={d.report.warnings ?? []} tone="warning" />
      </div>
      {Object.keys(info).length > 0 && (
        <dl className="tabular grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          {['stops', 'routes', 'trips', 'stop_times', 'shape_points', 'calendars', 'calendar_dates', 'transfers'].map(
            (k) =>
              info[k] != null && (
                <div key={k}>
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-medium">{fmtNumber(info[k] as number)}</dd>
                </div>
              ),
          )}
          {graph.components != null && (
            <div>
              <dt className="text-muted-foreground">components</dt>
              <dd className="font-medium">{String(graph.components)} ({(graph.component_sizes as number[]).join(', ')})</dd>
            </div>
          )}
          {info.latest_scheduled_time != null && (
            <div>
              <dt className="text-muted-foreground">latest time</dt>
              <dd className="font-medium">{String(info.latest_scheduled_time)}</dd>
            </div>
          )}
          {Array.isArray(info.files_present) && (
            <div className="col-span-2">
              <dt className="text-muted-foreground">files</dt>
              <dd className="font-medium">{(info.files_present as string[]).join(', ')}</dd>
            </div>
          )}
          {Array.isArray(info.optional_missing) && (info.optional_missing as string[]).length > 0 && (
            <div className="col-span-2">
              <dt className="text-muted-foreground">optional files absent</dt>
              <dd className="font-medium">{(info.optional_missing as string[]).join(', ')}</dd>
            </div>
          )}
        </dl>
      )}
      {Array.isArray(graph.notes) && (graph.notes as string[]).length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {(graph.notes as string[]).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Import log</h4>
        <ol className="max-h-56 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-[11px]">
          {d.logs.map((l, i) => (
            <li key={i} className={cn(l.level === 'error' && 'text-danger', l.level === 'warn' && 'text-warning')}>
              <span className="text-muted-foreground">{new Date(l.at).toLocaleTimeString()} </span>[{l.level}] {l.message}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

export default function DataPage() {
  const qc = useQueryClient()
  const meta = useMeta()
  const list = useQuery({ queryKey: ['datasets'], queryFn: api.datasets })
  const [token, setToken] = useState(readToken)
  const [tokenInput, setTokenInput] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  const [activate, setActivate] = useState(true)
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)

  const refreshAll = () => {
    qc.invalidateQueries()
  }
  const onError = (e: unknown) => setMessage({ tone: 'danger', text: e instanceof Error ? e.message : 'Failed' })

  const check = useMutation({
    mutationFn: (t: string) => api.adminCheck(t),
    onSuccess: (_, t) => {
      try {
        sessionStorage.setItem(TOKEN_KEY, t)
      } catch {
        /* keep in memory only */
      }
      setToken(t)
      setTokenInput('')
    },
  })
  const upload = useMutation({
    mutationFn: () => api.upload(token, file!, label, activate),
    onSuccess: (d) => {
      setMessage({ tone: 'success', text: `Imported dataset #${d.id}${d.is_active ? ' and activated it' : ''}.` })
      setFile(null)
      setLabel('')
      setExpanded(d.id)
      refreshAll()
    },
    onError: (e) => {
      onError(e)
      if (e instanceof ApiError && typeof e.details.dataset_id === 'number') setExpanded(e.details.dataset_id)
      qc.invalidateQueries({ queryKey: ['datasets'] })
    },
  })
  const refresh = useMutation({ mutationFn: () => api.refresh(token), onSuccess: (d) => { setMessage({ tone: 'success', text: `Refreshed: dataset #${d.id}.` }); refreshAll() }, onError })
  const act = useMutation({ mutationFn: (id: number) => api.activate(token, id), onSuccess: (d) => { setMessage({ tone: 'success', text: `Dataset #${d.id} is now active.` }); refreshAll() }, onError })
  const rebuild = useMutation({ mutationFn: () => api.rebuild(token), onSuccess: (r) => { setMessage({ tone: 'success', text: `Graph rebuilt: ${r.stations} stations, ${r.edges} edges.` }); refreshAll() }, onError })

  const submitUpload = (e: FormEvent) => {
    e.preventDefault()
    if (file) upload.mutate()
  }
  const active = meta.data?.dataset

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="System"
        title="Dataset management"
        description="MetroMind's stations, lines, connections and timetables all come from an imported GTFS feed. Nothing is hard-coded or simulated."
      />

      {message && (
        <Callout tone={message.tone} action={<Button size="sm" variant="ghost" onClick={() => setMessage(null)}>Dismiss</Button>}>
          {message.text}
        </Callout>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Active dataset</CardTitle>
          </CardHeader>
          <CardContent>
            {meta.isLoading ? (
              <Skeleton className="h-28" />
            ) : !active ? (
              <EmptyState title="No dataset is active">Upload a GTFS ZIP (admin) to enable routing.</EmptyState>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">#{active.id} · {active.label}</span>
                  <Badge tone={meta.data!.freshness.status === 'current' ? 'success' : 'warning'}>{meta.data!.freshness.status}</Badge>
                </div>
                <p className="text-muted-foreground">{meta.data!.freshness.message}</p>
                <dl className="tabular grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                  <div><dt className="text-muted-foreground">Imported</dt><dd>{fmtDate(active.imported_at)}</dd></div>
                  <div><dt className="text-muted-foreground">Service window</dt><dd>{active.service_start} – {active.service_end}</dd></div>
                  <div><dt className="text-muted-foreground">Timezone</dt><dd>{active.timezone ?? '—'}</dd></div>
                  <div><dt className="text-muted-foreground">Feed version</dt><dd>{active.feed_version ?? 'not declared'}</dd></div>
                  <div><dt className="text-muted-foreground">Source</dt><dd className="truncate" title={active.source_url ?? active.source_filename ?? ''}>{active.source_kind}: {active.source_filename ?? active.source_url ?? '—'}</dd></div>
                  <div><dt className="text-muted-foreground">SHA-256</dt><dd className="font-mono" title={active.sha256}>{active.sha256.slice(0, 12)}…</dd></div>
                </dl>
                {active.source_url && (
                  <p className="break-all text-xs text-muted-foreground">Obtained from: {active.source_url}</p>
                )}
                {active.attribution && <p className="text-xs text-muted-foreground">Attribution: {active.attribution}</p>}
                {meta.data!.network_notes.length > 0 && (
                  <ul className="list-disc pl-5 text-xs text-muted-foreground">
                    {meta.data!.network_notes.map((n) => <li key={n}>{n}</li>)}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {STATIC_MODE ? (
          <Card>
            <CardHeader>
              <CardTitle>Static demo</CardTitle>
              <CardDescription>This copy of MetroMind runs entirely in your browser.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                The real Python backend (validation, graph building and every algorithm) runs locally via Pyodide. The GTFS
                feed listed here is bundled with the site and validated each time the page loads.
              </p>
              <p>
                Uploading, refreshing and rolling back datasets need the full server (FastAPI + PostgreSQL); see the README in the
                repository. Saved routes and history stay in this browser only.
              </p>
            </CardContent>
          </Card>
        ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              {token ? <LockOpen className="size-4 text-success" /> : <KeyRound className="size-4" />} Administration
            </CardTitle>
            <CardDescription>Uploads, refreshes, activation and rebuilds need the server's admin token.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!token ? (
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (tokenInput) check.mutate(tokenInput) }}>
                <Input type="password" autoComplete="off" aria-label="Admin token" placeholder="Admin token" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} />
                <Button type="submit" loading={check.isPending} disabled={!tokenInput}>Unlock</Button>
              </form>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => refresh.mutate()} loading={refresh.isPending}>
                  <CloudDownload /> Refresh from source URL
                </Button>
                <Button size="sm" variant="outline" onClick={() => rebuild.mutate()} loading={rebuild.isPending}>
                  <Hammer /> Rebuild graph
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { try { sessionStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ } setToken('') }}>
                  Lock
                </Button>
              </div>
            )}
            {check.error && <Callout tone="danger">{(check.error as Error).message}</Callout>}

            {token && (
              <form className="space-y-2 rounded-md border p-3" onSubmit={submitUpload}>
                <Label htmlFor="gtfs">Upload a GTFS ZIP</Label>
                <Input id="gtfs" type="file" accept=".zip,application/zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="pt-1.5" />
                <Input aria-label="Dataset label" placeholder="Label (e.g. DMRC GTFS, Aug 2023)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} />
                <label className="flex items-center gap-2 text-xs">
                  <Switch checked={activate} onCheckedChange={setActivate} aria-label="Activate after import" /> Activate after a successful import
                </label>
                <Button type="submit" size="sm" disabled={!file} loading={upload.isPending}>
                  <Upload /> Validate & import
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  The archive is validated in memory (paths, size, required files, references) before anything is stored. A failed
                  import never replaces the active dataset.
                </p>
              </form>
            )}
            <p className="text-[11px] text-muted-foreground">
              Official DMRC data: otd.delhi.gov.in/data/staticDMRC/ (requires accepting the portal's terms and a short declaration). See
              the README for import instructions.
            </p>
          </CardContent>
        </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Import history</CardTitle>
          <CardDescription>Every import attempt, with its validation report. Activate an older valid version to roll back.</CardDescription>
        </CardHeader>
        <CardContent>
          {list.isLoading && <Skeleton className="h-24" />}
          {list.data?.length === 0 && <EmptyState title="Nothing imported yet" />}
          <ul className="divide-y rounded-md border">
            {list.data?.map((d: Dataset) => (
              <li key={d.id}>
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                    aria-expanded={expanded === d.id}
                    onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                  >
                    <ChevronDown className={cn('size-4 shrink-0 transition-transform', expanded === d.id && 'rotate-180')} />
                    <span className="tabular text-xs text-muted-foreground">#{d.id}</span>
                    <span className="truncate text-sm font-medium">{d.label}</span>
                    <Badge tone={d.status === 'valid' ? 'success' : d.status === 'failed' ? 'danger' : 'neutral'}>{d.status}</Badge>
                    {d.is_active && <Badge tone="primary">active</Badge>}
                  </button>
                  <span className="text-xs text-muted-foreground">{fmtDate(d.imported_at)}</span>
                  {token && d.status === 'valid' && !d.is_active && (
                    <Button size="sm" variant="outline" onClick={() => act.mutate(d.id)} loading={act.isPending && act.variables === d.id}>
                      <RotateCcw /> Activate
                    </Button>
                  )}
                </div>
                {expanded === d.id && (
                  <div className="border-t bg-muted/20 p-3">
                    <DatasetReport id={d.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
