import { useQuery } from '@tanstack/react-query'
import { HelpCircle, Play } from 'lucide-react'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DataGate } from '@/components/DataGate'
import { LineChip } from '@/components/LineChip'
import { Badge, Button, Callout, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, PageHeader, Skeleton, Stat, Tip } from '@/components/ui'
import { api } from '@/lib/api'
import { ALGO_COLORS, fmtMs, fmtNumber, hex, OBJECTIVE_LABELS } from '@/lib/format'
import { useLines } from '@/lib/queries'
import type { Meta, Objective } from '@/lib/types'

export default function AnalyticsPage() {
  return <DataGate>{(meta) => <Analytics meta={meta} />}</DataGate>
}

const axis = { fontSize: 11, fill: 'currentColor' }
const tooltipStyle = {
  contentStyle: { background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: 'var(--color-foreground)' },
}

function Explain({ text }: { text?: string }) {
  if (!text) return null
  return (
    <Tip content={text}>
      <button type="button" aria-label="What does this mean?" className="cursor-help text-muted-foreground">
        <HelpCircle className="size-3.5" />
      </button>
    </Tip>
  )
}

function Analytics({ meta }: { meta: Meta }) {
  const q = useQuery({ queryKey: ['analytics'], queryFn: api.analytics, staleTime: 10 * 60_000 })
  const { lines } = useLines()
  const [pairs, setPairs] = useState(30)
  const [seed, setSeed] = useState(42)
  const [objective, setObjective] = useState<Objective>('time')
  const [benchArgs, setBenchArgs] = useState<{ pairs: number; seed: number; objective: Objective } | null>(null)
  const bench = useQuery({
    queryKey: ['benchmark', benchArgs],
    queryFn: () => api.benchmark(benchArgs!.pairs, benchArgs!.seed, benchArgs!.objective),
    enabled: !!benchArgs,
    staleTime: Infinity,
  })

  const a = q.data
  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Insights"
        title="Network analytics"
        description={`Topology of the active dataset (${meta.dataset.label}). Centrality describes network structure — how many shortest paths pass through a station — not passenger demand.`}
      />
      {q.isLoading && <Skeleton className="h-64" />}
      {q.error && <Callout tone="danger">{(q.error as Error).message}</Callout>}
      {a && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Stations" value={fmtNumber(a.summary.stations)} hint={`${a.summary.routable_stations} served`} />
            <Stat label="Lines" value={a.summary.lines} hint={`${a.summary.routes} route variants`} />
            <Stat label="Interchanges" value={a.summary.interchanges} hint="stations on ≥2 lines" />
            <Stat label="Track segments" value={a.summary.track_segments} hint={`${a.summary.directed_edges} directed edges`} />
            <Stat label="Components" value={a.summary.connected_components} hint="ignoring direction" />
            <Stat label="Avg. hops" value={a.path_statistics.avg_hops ?? '—'} hint={`diameter ${a.path_statistics.diameter_hops ?? '—'}`} />
          </div>

          {a.summary.connected_components > 1 && (
            <Callout tone="warning" title={`The network has ${a.summary.connected_components} disconnected parts`}>
              {a.components.map((c, i) => (
                <span key={i} className="block">
                  Part {i + 1}: {c.size} stations (e.g. {c.sample.slice(0, 3).join(', ')})
                </span>
              ))}
              Journeys between parts are impossible with this data. The feed defines no transfer link (transfers.txt) between them.
            </Callout>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  Most central stations <Explain text={a.metric_notes.betweenness} />
                </CardTitle>
                <CardDescription>Betweenness centrality (fewest-hop paths){a.betweenness_sampled && ' — sampled'}</CardDescription>
              </CardHeader>
              <CardContent className="h-80">
                <ResponsiveContainer>
                  <BarChart data={a.top_betweenness} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                    <XAxis type="number" tick={axis} />
                    <YAxis type="category" dataKey="name" tick={axis} width={150} interval={0} />
                    <Tooltip {...tooltipStyle} />
                    <Bar dataKey="betweenness" radius={[0, 4, 4, 0]}>
                      {a.top_betweenness.map((s) => (
                        <Cell key={s.id} fill={hex(lines.get(s.lines[0])?.color ?? '3b6ff0')} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  Degree distribution <Explain text={a.metric_notes.degree} />
                </CardTitle>
                <CardDescription>How many stations connect to 1, 2, 3… neighbouring stations</CardDescription>
              </CardHeader>
              <CardContent className="h-80">
                <ResponsiveContainer>
                  <BarChart data={a.degree_distribution} margin={{ left: -10, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="degree" tick={axis} label={{ value: 'degree', position: 'insideBottom', offset: -2, fontSize: 11 }} />
                    <YAxis tick={axis} allowDecimals={false} />
                    <Tooltip {...tooltipStyle} />
                    <Bar dataKey="stations" fill="#3b6ff0" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Lines</CardTitle>
                <CardDescription>From the active feed's routes and trips</CardDescription>
              </CardHeader>
              <CardContent>
                <table className="tabular w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 font-medium">Line</th>
                      <th className="py-1 text-right font-medium">Stations</th>
                      <th className="py-1 text-right font-medium">Variants</th>
                      <th className="py-1 text-right font-medium">Trips</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.lines.map((l) => (
                      <tr key={l.id} className="border-t">
                        <td className="py-1.5">
                          <LineChip name={l.name} color={l.color} />
                        </td>
                        <td className="py-1.5 text-right">{l.stations}</td>
                        <td className="py-1.5 text-right">{l.routes}</td>
                        <td className="py-1.5 text-right">{fmtNumber(l.trips)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Scheduled hop times</CardTitle>
                <CardDescription>Distribution of station-to-station scheduled times (1-minute bins)</CardDescription>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer>
                  <BarChart data={a.hop_time_distribution.map((h) => ({ ...h, label: `${h.from_min}–${h.to_min}` }))} margin={{ left: -10, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="label" tick={axis} />
                    <YAxis tick={axis} allowDecimals={false} />
                    <Tooltip {...tooltipStyle} />
                    <Bar dataKey="count" name="segments" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                {a.path_statistics.avg_time_min != null && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Average shortest ride time between station pairs: {a.path_statistics.avg_time_min} min (max {a.path_statistics.max_time_min} min),{' '}
                    {String(a.path_statistics.time_basis)}.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Interchange stations</CardTitle>
              <CardDescription>Stations served by more than one line (derived from trips, not names)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {a.interchanges.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                    <span className="truncate text-sm font-medium">{s.name}</span>
                    <span className="flex shrink-0 gap-1">
                      {s.lines.map((l) => (
                        <LineChip key={l} lineId={l} />
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Algorithm benchmark</CardTitle>
          <CardDescription>
            Runs all four searches on random station pairs (fixed seed, largest strongly connected component) and compares against Dijkstra.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              setBenchArgs({ pairs, seed, objective })
            }}
          >
            <div className="w-28 space-y-1">
              <Label htmlFor="pairs">Pairs</Label>
              <Input id="pairs" type="number" min={5} max={200} value={pairs} onChange={(e) => setPairs(Math.max(5, Math.min(200, Number(e.target.value) || 5)))} />
            </div>
            <div className="w-28 space-y-1">
              <Label htmlFor="seed">Seed</Label>
              <Input id="seed" type="number" min={0} max={10000} value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
            </div>
            <div className="w-48 space-y-1">
              <Label htmlFor="bobj">Objective</Label>
              <NativeSelect id="bobj" value={objective} onChange={(e) => setObjective(e.target.value as Objective)}>
                {meta.capabilities.objectives.map((o) => (
                  <option key={o.id} value={o.id} disabled={!o.supported}>
                    {OBJECTIVE_LABELS[o.id]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button type="submit" loading={bench.isFetching}>
              <Play /> Run benchmark
            </Button>
          </form>
          {bench.error && <Callout tone="danger">{(bench.error as Error).message}</Callout>}
          {bench.data && (
            <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
              <div className="overflow-x-auto">
                <table className="tabular w-full min-w-[560px] text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 font-medium">Algorithm</th>
                      <th className="py-1 text-right font-medium">Mean expanded</th>
                      <th className="py-1 text-right font-medium">Median time</th>
                      <th className="py-1 text-right font-medium">Optimal share</th>
                      <th className="py-1 text-right font-medium">Mean / max gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bench.data.results.map((r) => (
                      <tr key={r.algorithm} className="border-t">
                        <td className="py-1.5">
                          <span className="flex items-center gap-2">
                            <span className="size-2.5 rounded-full" style={{ background: ALGO_COLORS[r.algorithm] }} />
                            {r.algorithm_name}
                          </span>
                        </td>
                        <td className="py-1.5 text-right">{fmtNumber(r.mean_expanded, 1)}</td>
                        <td className="py-1.5 text-right">{fmtMs(r.median_runtime_ms)}</td>
                        <td className="py-1.5 text-right">
                          {r.optimal_share != null ? (
                            <Badge tone={r.optimal_share === 1 ? 'success' : 'warning'}>{Math.round(r.optimal_share * 100)}%</Badge>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-1.5 text-right">
                          {r.mean_gap_pct ?? '—'}% / {r.max_gap_pct ?? '—'}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted-foreground">
                  {bench.data.pairs} pairs · seed {bench.data.seed} · {bench.data.objective_description} {bench.data.note}
                </p>
              </div>
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={bench.data.results} margin={{ left: -10, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="algorithm" tick={axis} />
                    <YAxis tick={axis} />
                    <Tooltip {...tooltipStyle} />
                    <Bar dataKey="mean_expanded" name="mean expanded" radius={[4, 4, 0, 0]}>
                      {bench.data.results.map((r) => (
                        <Cell key={r.algorithm} fill={ALGO_COLORS[r.algorithm]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
