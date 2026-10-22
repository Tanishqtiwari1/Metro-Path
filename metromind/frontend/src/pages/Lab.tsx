import { useMutation } from '@tanstack/react-query'
import { ChevronFirst, ChevronLast, Pause, Play, SkipBack, SkipForward, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { DataGate } from '@/components/DataGate'
import { JourneyMetrics } from '@/components/journey/Journey'
import { TransitMap, type ExploreOverlay } from '@/components/map/TransitMap'
import { StationCombobox } from '@/components/StationCombobox'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Label,
  NativeSelect,
  Segmented,
  Skeleton,
  Slider,
} from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import { fmtCost, fmtMs, fmtNumber, OBJECTIVE_LABELS } from '@/lib/format'
import { usePrefs } from '@/lib/prefs'
import { useNetworkMap } from '@/lib/queries'
import type { Meta, Objective, RunResponse, SearchAlgorithm, StationSummary, TraceEvent } from '@/lib/types'
import { cn } from '@/lib/utils'

export default function LabPage() {
  return <DataGate>{(meta) => <Lab meta={meta} />}</DataGate>
}

const ALGOS: { value: SearchAlgorithm; label: string }[] = [
  { value: 'gbfs', label: 'Greedy BFS' },
  { value: 'bfs', label: 'BFS' },
  { value: 'dijkstra', label: 'Dijkstra' },
  { value: 'astar', label: 'A*' },
]

function fmtVal(v: number | number[] | undefined): string {
  if (v == null) return '—'
  if (Array.isArray(v)) return `(${v.map((x) => Math.round(x * 10) / 10).join(', ')})`
  return String(Math.round(v * 100) / 100)
}

/** Replays a recorded trace up to step `idx` into map/frontier state. */
function useReplay(events: TraceEvent[], idx: number) {
  return useMemo(() => {
    const expanded = new Set<string>()
    const discovered = new Set<string>()
    const order = new Map<string, number>()
    let current: string | null = null
    let frontier: TraceEvent['frontier'] = null
    let lastExpand: TraceEvent | null = null
    for (let i = 0; i < idx && i < events.length; i++) {
      const e = events[i]
      if (e.type === 'expand') {
        expanded.add(e.node)
        if (!order.has(e.node)) order.set(e.node, order.size)
        current = e.node
        frontier = e.frontier ?? frontier
        lastExpand = e
      } else if (e.type === 'discover' || e.type === 'update') {
        discovered.add(e.node)
      } else if (e.type === 'goal') {
        current = e.node
      }
    }
    const frontierNodes = new Set((frontier ?? []).map((f) => f.node).filter((n) => !expanded.has(n)))
    return { expanded, discovered, order, current, frontier, frontierNodes, lastExpand }
  }, [events, idx])
}

function Lab({ meta }: { meta: Meta }) {
  const { prefs } = usePrefs()
  const network = useNetworkMap()
  const [origin, setOrigin] = useState<StationSummary | null>(null)
  const [destination, setDestination] = useState<StationSummary | null>(null)
  const [algorithm, setAlgorithm] = useState<SearchAlgorithm>('gbfs')
  const [objective, setObjective] = useState<Objective>('time')
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(prefs.traceSpeed)

  const run = useMutation({
    mutationFn: () =>
      api.run({
        origin: origin!.id,
        destination: destination!.id,
        algorithm,
        objective,
        transfer_penalty_s: prefs.transferPenaltyS ?? meta.defaults.transfer_penalty_s,
        trace: true,
      }),
    onSuccess: () => {
      setIdx(0)
      setPlaying(true)
    },
  })
  const data: RunResponse | undefined = run.data
  const ran = data?.search.algorithm
  const events = useMemo(() => data?.search.trace?.events ?? [], [data])
  const total = events.length
  const replay = useReplay(events, idx)
  const done = total > 0 && idx >= total

  const isPlaying = playing && idx < total
  useEffect(() => {
    if (!isPlaying) return
    const t = setTimeout(() => {
      setIdx((i) => Math.min(total, i + 1))
      if (idx + 1 >= total) setPlaying(false)
    }, 1000 / speed)
    return () => clearTimeout(t)
  }, [isPlaying, idx, total, speed])

  // Keyboard: space = play/pause, arrows = step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Let focused controls handle their own keys (a focused button already toggles on Space).
      if (!total || (e.target as HTMLElement)?.closest('input,select,textarea,button,a,[role=combobox],[role=slider]')) return
      if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.key === 'ArrowRight') setIdx((i) => Math.min(total, i + 1))
      else if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [total])

  const explore: ExploreOverlay | undefined = data
    ? { expanded: replay.expanded, discovered: replay.discovered, frontier: replay.frontierNodes, current: done ? null : replay.current, order: replay.order }
    : undefined

  const routes =
    done && data?.journey ? [{ key: 'final', rides: data.journey.rides, stations: data.journey.stations }] : []
  const current = idx > 0 ? events[idx - 1] : null
  const recent = events.slice(Math.max(0, idx - 40), idx).reverse()
  const err = run.error as ApiError | null

  return (
    <div className="flex h-full flex-col lg:grid lg:grid-cols-[400px_1fr]">
      <div className="order-2 border-r lg:order-1 lg:overflow-y-auto">
      <section aria-label="Lab controls" className="space-y-3 p-4">
        <div>
          <h1 className="text-base font-semibold">Algorithm lab</h1>
          <p className="text-xs text-muted-foreground">Watch a real execution trace, step by step.</p>
        </div>
        <StationCombobox label="Origin" icon="origin" value={origin} onChange={setOrigin} />
        <StationCombobox label="Destination" icon="destination" value={destination} onChange={setDestination} />
        <div className="space-y-1.5">
          <Label>Algorithm</Label>
          <Segmented label="Algorithm" value={algorithm} onChange={setAlgorithm} options={ALGOS} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lab-obj">Objective (cost model)</Label>
          <NativeSelect id="lab-obj" value={objective} onChange={(e) => setObjective(e.target.value as Objective)}>
            {meta.capabilities.objectives.map((o) => (
              <option key={o.id} value={o.id} disabled={!o.supported}>
                {OBJECTIVE_LABELS[o.id]}
              </option>
            ))}
          </NativeSelect>
          {(algorithm === 'bfs' || algorithm === 'gbfs') && (
            <p className="text-[11px] text-muted-foreground">
              {algorithm === 'bfs' ? 'BFS' : 'GBFS'} ignores edge costs; the objective is only used to cost its result.
            </p>
          )}
        </div>
        <Button className="w-full" disabled={!origin || !destination} loading={run.isPending} onClick={() => run.mutate()}>
          <Sparkles /> Run & visualise
        </Button>
        {err && <Callout tone="danger" title="Run failed">{err.message}</Callout>}

        {data && (
          <Card>
            <CardHeader>
              <CardTitle>{data.algorithm_info.name}</CardTitle>
              <CardDescription>{data.algorithm_info.summary}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex flex-wrap gap-1">
                <Badge tone="primary">{data.algorithm_info.informed ? 'informed' : 'uninformed'}</Badge>
                <Badge tone="outline">optimal: {String(data.algorithm_info.optimal)}</Badge>
                <Badge tone="outline">{data.algorithm_info.complexity}</Badge>
              </div>
              <p>
                <span className="font-medium">Search space:</span> <span className="text-muted-foreground">{data.space}</span>
              </p>
              {data.heuristic && (
                <p>
                  <span className="font-medium">Heuristic:</span> <span className="text-muted-foreground">{data.heuristic}</span>
                </p>
              )}
              <p className="text-muted-foreground">{data.objective_description}</p>
              <dl className="tabular grid grid-cols-2 gap-1 border-t pt-2">
                <dt className="text-muted-foreground">Expanded</dt>
                <dd>{fmtNumber(data.search.expanded)}</dd>
                <dt className="text-muted-foreground">Explored (distinct)</dt>
                <dd>{fmtNumber(data.search.discovered)}</dd>
                <dt className="text-muted-foreground">Peak frontier</dt>
                <dd>{fmtNumber(data.search.max_frontier)}</dd>
                <dt className="text-muted-foreground">Run time</dt>
                <dd>{fmtMs(data.search.runtime_ms)}</dd>
                {data.journey && (
                  <>
                    <dt className="text-muted-foreground">Route cost</dt>
                    <dd>{fmtCost(data.journey.metrics.objective_cost, data.journey.metrics.objective_unit)}</dd>
                  </>
                )}
              </dl>
              {ran === 'gbfs' && (
                <Callout tone="info">
                  GBFS always expands the station closest (in a straight line) to the destination and never reconsiders the
                  distance already travelled, so its route can be longer than the optimum. Compare it with A* on the same trip.
                </Callout>
              )}
              {data.search.trace?.truncated && (
                <Callout tone="warning">
                  Trace recording stopped after {data.search.trace.max_events} events to keep the browser responsive; the search
                  itself ran to completion.
                </Callout>
              )}
            </CardContent>
          </Card>
        )}
      </section>

      <section aria-label="Trace details" className="space-y-3 border-t p-4">
        {!data ? (
          <EmptyState title="No trace yet">The frontier (priority queue), current node and event log appear here.</EmptyState>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Current step</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {!current ? (
                  <p className="text-muted-foreground">Start of search at {origin?.name}.</p>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Badge tone={current.type === 'goal' ? 'success' : current.type === 'expand' ? 'primary' : 'neutral'}>{current.type}</Badge>
                      <span className="font-medium">{current.label ?? current.node}</span>
                    </div>
                    <dl className="tabular grid grid-cols-3 gap-1 text-xs">
                      <div>
                        <dt className="text-muted-foreground">g(n)</dt>
                        <dd>{fmtVal(current.g)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">h(n)</dt>
                        <dd>{fmtVal(current.h)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">f / priority</dt>
                        <dd>{fmtVal(current.f)}</dd>
                      </div>
                    </dl>
                    <p className="text-xs text-muted-foreground">
                      {replay.expanded.size} stations expanded · {replay.discovered.size} discovered
                    </p>
                  </div>
                )}
                {done && data.journey && (
                  <div className="mt-3 border-t pt-3">
                    <JourneyMetrics journey={data.journey} />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Frontier {ran === 'bfs' ? '(FIFO queue)' : '(priority queue)'}</CardTitle>
                <CardDescription>
                  Top entries just before the latest expansion
                  {replay.lastExpand?.frontier_size != null && ` · size ${replay.lastExpand.frontier_size}`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {replay.frontier && replay.frontier.length > 0 ? (
                  <table className="tabular w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="py-1 font-medium">#</th>
                        <th className="py-1 font-medium">State</th>
                        <th className="py-1 text-right font-medium">{ran === 'gbfs' ? 'h (km)' : ran === 'bfs' ? 'depth' : ran === 'astar' ? 'f' : 'g'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {replay.frontier.map((f, i) => (
                        <tr key={i} className={cn('border-t', i === 0 && 'font-medium text-primary')}>
                          <td className="py-1">{i + 1}</td>
                          <td className="max-w-[180px] truncate py-1" title={f.label}>
                            {f.label}
                          </td>
                          <td className="py-1 text-right">{fmtVal(f.priority)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-xs text-muted-foreground">Empty.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Event log</CardTitle>
                <CardDescription>Newest first · click to jump</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="max-h-80 space-y-0.5 overflow-auto text-xs">
                  {recent.map((e) => (
                    <li key={e.i}>
                      <button
                        type="button"
                        onClick={() => { setPlaying(false); setIdx(e.i + 1) }}
                        className="flex w-full cursor-pointer gap-2 rounded px-1 py-0.5 text-left hover:bg-muted"
                      >
                        <span className="tabular w-9 shrink-0 text-muted-foreground">{e.i}</span>
                        <span className={cn('w-14 shrink-0', e.type === 'expand' && 'text-primary', e.type === 'goal' && 'font-semibold text-success')}>
                          {e.type}
                        </span>
                        <span className="truncate">{e.label ?? e.node}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </>
        )}
      </section>
      </div>
      <section aria-label="Search visualisation" className="relative order-1 h-[60vh] shrink-0 lg:order-2 lg:h-full">
        {network.data ? (
          <TransitMap
            network={network.data}
            explore={explore}
            routes={routes}
            fitKey={data ? `${data.search.algorithm}-${origin?.id}-${destination?.id}-${done ? 'route' : 'search'}` : 'net'}
          />
        ) : (
          <Skeleton className="h-full w-full rounded-none" />
        )}
        {data && (
          <div className="absolute inset-x-3 bottom-6 z-[500] mx-auto max-w-xl rounded-lg border bg-card/95 p-3 shadow-pop backdrop-blur">
            <div className="flex items-center gap-1">
              <Button size="icon-sm" variant="ghost" aria-label="Reset" onClick={() => { setPlaying(false); setIdx(0) }}>
                <ChevronFirst />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Step back" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>
                <SkipBack />
              </Button>
              <Button size="icon-sm" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={() => (done ? (setIdx(0), setPlaying(true)) : setPlaying((p) => !p))}>
                {isPlaying ? <Pause /> : <Play />}
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Step forward" disabled={done} onClick={() => setIdx((i) => Math.min(total, i + 1))}>
                <SkipForward />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Jump to end" onClick={() => { setPlaying(false); setIdx(total) }}>
                <ChevronLast />
              </Button>
              <div className="ml-2 flex-1">
                <Slider label="Trace position" min={0} max={total} step={1} value={[idx]} onValueChange={([v]) => { setPlaying(false); setIdx(v) }} />
              </div>
              <span className="tabular w-20 text-right text-xs text-muted-foreground">
                {idx}/{total}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-sky-500" /> expanded (early→late)</span>
              <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-amber-500" /> frontier</span>
              <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-amber-200" /> discovered</span>
              <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-red-500" /> current</span>
              <label className="ml-auto flex items-center gap-1.5">
                speed
                <input
                  type="range"
                  min={1}
                  max={120}
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  aria-label="Playback speed (events per second)"
                  className="w-20 accent-[hsl(var(--primary))]"
                />
              </label>
            </div>
          </div>
        )}
        {!data && network.data && (
          <div className="absolute left-14 top-3 z-[500] rounded-md bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-pop">
            Pick two stations and an algorithm, then press Run.
          </div>
        )}
      </section>

    </div>
  )
}
