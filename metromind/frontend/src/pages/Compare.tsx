import { useMutation } from '@tanstack/react-query'
import { GitCompareArrows } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ErrorBar, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { DataGate } from '@/components/DataGate'
import { LineChip } from '@/components/LineChip'
import { TransitMap } from '@/components/map/TransitMap'
import { StationCombobox } from '@/components/StationCombobox'
import { Badge, Button, Callout, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Input, Label, NativeSelect, PageHeader } from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import { ALGO_COLORS, fmtCost, fmtDistance, fmtDuration, fmtMs, fmtNumber, OBJECTIVE_LABELS } from '@/lib/format'
import { usePrefs } from '@/lib/prefs'
import { useNetworkMap } from '@/lib/queries'
import type { CompareResponse, Meta, Objective, SearchAlgorithm, StationSummary } from '@/lib/types'

export default function ComparePage() {
  return <DataGate>{(meta) => <Compare meta={meta} />}</DataGate>
}

const ALL: SearchAlgorithm[] = ['gbfs', 'bfs', 'dijkstra', 'astar']
const SHORT: Record<SearchAlgorithm, string> = { gbfs: 'GBFS', bfs: 'BFS', dijkstra: 'Dijkstra', astar: 'A*' }

function costScalar(c: number | number[] | null): number | null {
  if (c == null) return null
  return Array.isArray(c) ? c[1] : c
}

function ChartCard({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {desc && <CardDescription>{desc}</CardDescription>}
      </CardHeader>
      <CardContent className="h-56">{children}</CardContent>
    </Card>
  )
}

const axis = { fontSize: 11, fill: 'currentColor' }
const tooltipStyle = {
  contentStyle: { background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: 'var(--color-foreground)' },
}

function Compare({ meta }: { meta: Meta }) {
  const { prefs } = usePrefs()
  const network = useNetworkMap()
  const [origin, setOrigin] = useState<StationSummary | null>(null)
  const [destination, setDestination] = useState<StationSummary | null>(null)
  const [objective, setObjective] = useState<Objective>('time')
  const [algos, setAlgos] = useState<Set<SearchAlgorithm>>(new Set(ALL))
  const [repeats, setRepeats] = useState(10)
  const [shownOnMap, setShownOnMap] = useState<Set<SearchAlgorithm>>(new Set(ALL))

  const cmp = useMutation({
    mutationFn: () =>
      api.compare({
        origin: origin!.id,
        destination: destination!.id,
        objective,
        algorithms: ALL.filter((a) => algos.has(a)),
        repeats,
        transfer_penalty_s: prefs.transferPenaltyS ?? meta.defaults.transfer_penalty_s,
      }),
  })
  const data: CompareResponse | undefined = cmp.data
  const err = cmp.error as ApiError | null

  const rows = useMemo(
    () =>
      (data?.results ?? []).map((r) => ({
        name: r.algorithm_name,
        short: SHORT[r.algorithm],
        algo: r.algorithm,
        mean: +r.timing_ms.mean.toFixed(4),
        sd: +r.timing_ms.stdev.toFixed(4),
        expanded: r.expanded,
        discovered: r.discovered,
        cost: (() => {
          const c = costScalar(r.journey?.metrics.objective_cost ?? null)
          // Present seconds as minutes for readability; other units are shown as-is.
          return c != null && (data?.objective === 'time' || data?.objective === 'transfers') ? +(c / 60).toFixed(1) : c
        })(),
        stops: r.journey?.metrics.stops ?? null,
        minutes: r.journey ? +(r.journey.metrics.total_time_s / 60).toFixed(1) : null,
        gap: r.optimality.gap_pct ?? 0,
        fill: ALGO_COLORS[r.algorithm],
      })),
    [data],
  )

  const toggle = (set: Set<SearchAlgorithm>, a: SearchAlgorithm, fn: (s: Set<SearchAlgorithm>) => void) => {
    const n = new Set(set)
    if (n.has(a)) n.delete(a)
    else n.add(a)
    fn(n)
  }

  const routes = (data?.results ?? [])
    .filter((r) => r.journey && shownOnMap.has(r.algorithm))
    .map((r) => ({ key: r.algorithm, rides: r.journey!.rides, stations: r.journey!.stations, color: ALGO_COLORS[r.algorithm].slice(1), dashed: r.algorithm !== 'dijkstra' }))

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Algorithms"
        title="Route comparison"
        description="Every algorithm gets the same origin, destination, dataset and objective, and is costed by the same evaluator."
      />

      <Card className="p-4">
        <form
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_180px_auto_120px_auto] xl:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            cmp.mutate()
          }}
        >
          <div className="space-y-1">
            <Label>Origin</Label>
            <StationCombobox label="Origin" icon="origin" value={origin} onChange={setOrigin} />
          </div>
          <div className="space-y-1">
            <Label>Destination</Label>
            <StationCombobox label="Destination" icon="destination" value={destination} onChange={setDestination} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cmp-obj">Objective</Label>
            <NativeSelect id="cmp-obj" value={objective} onChange={(e) => setObjective(e.target.value as Objective)}>
              {meta.capabilities.objectives.map((o) => (
                <option key={o.id} value={o.id} disabled={!o.supported}>
                  {OBJECTIVE_LABELS[o.id]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium text-muted-foreground">Algorithms</legend>
            <div className="flex h-9 flex-wrap items-center gap-3">
              {ALL.map((a) => (
                <label key={a} className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={algos.has(a)} onChange={() => toggle(algos, a, setAlgos)} className="accent-[hsl(var(--primary))]" />
                  {{ gbfs: 'GBFS', bfs: 'BFS', dijkstra: 'Dijkstra', astar: 'A*' }[a]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1">
            <Label htmlFor="rep">Timing runs</Label>
            <Input id="rep" type="number" min={1} max={meta.defaults.benchmark_max_repeats} value={repeats} onChange={(e) => setRepeats(Math.max(1, Math.min(meta.defaults.benchmark_max_repeats, Number(e.target.value) || 1)))} />
          </div>
          <Button type="submit" disabled={!origin || !destination || algos.size === 0} loading={cmp.isPending}>
            <GitCompareArrows /> Compare
          </Button>
        </form>
      </Card>

      {err && <Callout tone="danger" title="Comparison failed">{err.message}</Callout>}

      {!data && !cmp.isPending && !err && (
        <Card>
          <EmptyState icon={<GitCompareArrows />} title="Choose a trip to compare">
            Try a long cross-network trip: greedy search often takes a visibly different path from Dijkstra and A*.
          </EmptyState>
        </Card>
      )}

      {data && (
        <>
          <Callout tone="info" title={`Objective: ${OBJECTIVE_LABELS[data.objective]}`}>
            {data.objective_description} Reference optimum (Dijkstra): <span className="font-medium text-foreground">{fmtCost(data.reference_cost, data.objective_unit)}</span>.
          </Callout>

          <div className="overflow-x-auto rounded-lg border bg-card shadow-card">
            <table className="tabular w-full min-w-[860px] text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Algorithm</th>
                  <th className="px-3 py-2 font-medium">Route</th>
                  <th className="px-3 py-2 font-medium">Objective cost</th>
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Changes</th>
                  <th className="px-3 py-2 font-medium">Stops</th>
                  <th className="px-3 py-2 font-medium">Distance</th>
                  <th className="px-3 py-2 font-medium">Expanded</th>
                  <th className="px-3 py-2 font-medium">Explored</th>
                  <th className="px-3 py-2 font-medium">Runtime (mean ± sd)</th>
                  <th className="px-3 py-2 font-medium">Py heap peak</th>
                  <th className="px-3 py-2 font-medium">Optimality</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((r) => {
                  const m = r.journey?.metrics
                  return (
                    <tr key={r.algorithm} className="border-b last:border-0 align-top">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 font-medium">
                          <span className="size-2.5 rounded-full" style={{ background: ALGO_COLORS[r.algorithm] }} />
                          {r.algorithm_name}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {r.journey?.rides.map((ride, i) => <LineChip key={i} name={ride.line_name} color={ride.color} />) ?? '—'}
                        </div>
                      </td>
                      <td className="px-3 py-2">{m ? fmtCost(m.objective_cost, m.objective_unit) : 'no route'}</td>
                      <td className="px-3 py-2">{fmtDuration(m?.total_time_s)}</td>
                      <td className="px-3 py-2">{m?.transfers ?? '—'}</td>
                      <td className="px-3 py-2">{m?.stops ?? '—'}</td>
                      <td className="px-3 py-2">{fmtDistance(m?.distance_m)}</td>
                      <td className="px-3 py-2">{fmtNumber(r.expanded)}</td>
                      <td className="px-3 py-2">{fmtNumber(r.discovered)}</td>
                      <td className="px-3 py-2">
                        {fmtMs(r.timing_ms.mean)} <span className="text-muted-foreground">± {fmtMs(r.timing_ms.stdev)}</span>
                        <div className="text-[11px] text-muted-foreground">{r.timing_ms.runs} runs · median {fmtMs(r.timing_ms.median)}</div>
                      </td>
                      <td className="px-3 py-2">{fmtNumber(r.peak_python_alloc_kb, 0)} KB</td>
                      <td className="px-3 py-2">
                        {r.optimality.status === 'optimal' ? (
                          <Badge tone="success">{r.optimality.guaranteed ? 'optimal (guaranteed)' : 'matches optimum'}</Badge>
                        ) : r.optimality.status === 'suboptimal' ? (
                          <Badge tone="warning">
                            +{r.optimality.gap_pct != null ? `${r.optimality.gap_pct}%` : 'worse (lexicographic)'}
                          </Badge>
                        ) : (
                          <Badge>{r.optimality.status}</Badge>
                        )}
                        {r.journey && !r.journey.constraints_satisfied && <Badge tone="danger">violates limit</Badge>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <Card className="overflow-hidden p-0">
              <div className="flex flex-wrap items-center gap-3 border-b p-3 text-xs">
                <span className="font-semibold">Paths on the map</span>
                {data.results.map((r) => (
                  <label key={r.algorithm} className="flex cursor-pointer items-center gap-1.5">
                    <input type="checkbox" checked={shownOnMap.has(r.algorithm)} onChange={() => toggle(shownOnMap, r.algorithm, setShownOnMap)} />
                    <span className="h-1 w-4 rounded" style={{ background: ALGO_COLORS[r.algorithm] }} />
                    {r.algorithm_name}
                  </label>
                ))}
              </div>
              <div className="h-[380px]">
                {network.data && <TransitMap network={network.data} routes={routes} fitKey={`${origin?.id}-${destination?.id}-${data.objective}`} />}
              </div>
            </Card>
            <div className="grid gap-4 sm:grid-cols-2">
              <ChartCard title="Execution time" desc="Mean ± standard deviation (ms)">
                <ResponsiveContainer>
                  <BarChart data={rows} margin={{ left: -10, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="short" tick={axis} interval={0} />
                    <YAxis tick={axis} />
                    <Tooltip {...tooltipStyle} />
                    <Bar dataKey="mean" name="mean ms" radius={[4, 4, 0, 0]}>
                      {rows.map((r) => <Cell key={r.algo} fill={r.fill} />)}
                      <ErrorBar dataKey="sd" width={6} stroke="var(--color-muted-foreground)" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Expanded vs explored" desc="States expanded / distinct states seen">
                <ResponsiveContainer>
                  <BarChart data={rows} margin={{ left: -10, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="short" tick={axis} interval={0} />
                    <YAxis tick={axis} />
                    <Tooltip {...tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="expanded" fill="#3b6ff0" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="discovered" name="explored" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Route cost" desc={`Under the "${OBJECTIVE_LABELS[data.objective]}" objective (${data.objective === 'time' ? 'minutes' : data.objective === 'transfers' ? 'time component, minutes' : data.objective_unit})`}>
                <ResponsiveContainer>
                  <BarChart data={rows} margin={{ left: -4, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="short" tick={axis} interval={0} />
                    <YAxis tick={axis} />
                    <Tooltip {...tooltipStyle} />
                    <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                      {rows.map((r) => <Cell key={r.algo} fill={r.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Stops vs travel time" desc="Each point is one algorithm's route">
                <ResponsiveContainer>
                  <ScatterChart margin={{ left: -10, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis type="number" dataKey="stops" name="stops" tick={axis} allowDecimals={false} />
                    <YAxis type="number" dataKey="minutes" name="minutes" tick={axis} />
                    <ZAxis range={[90, 90]} />
                    <Tooltip {...tooltipStyle} cursor={{ strokeDasharray: '3 3' }} />
                    {rows.map((r) => (
                      <Scatter key={r.algo} name={r.name} data={[r]} fill={r.fill} />
                    ))}
                  </ScatterChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </div>

          <ChartCard title="Optimality gap" desc="% worse than Dijkstra's optimum under the same objective (0 = optimal)">
            <ResponsiveContainer>
              <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                <XAxis type="number" tick={axis} unit="%" />
                <YAxis type="category" dataKey="short" tick={axis} width={70} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="gap" radius={[0, 4, 4, 0]}>
                      {rows.map((r) => <Cell key={r.algo} fill={r.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <Callout tone="info" title="Reading these numbers">
            <ul className="list-disc space-y-1 pl-4">
              {data.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Callout>
        </>
      )}
    </div>
  )
}
