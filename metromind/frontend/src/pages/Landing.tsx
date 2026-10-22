import { ArrowRight, BarChart3, Database, FlaskConical, GitCompareArrows, Map as MapIcon, Navigation } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { StationCombobox } from '@/components/StationCombobox'
import { Badge, Button, buttonVariants, Callout, Card, Skeleton } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { fmtNumber } from '@/lib/format'
import { useMeta, useNetworkMap } from '@/lib/queries'
import type { StationSummary } from '@/lib/types'

const TransitMap = lazy(() => import('@/components/map/TransitMap').then((m) => ({ default: m.TransitMap })))

const FEATURES = [
  { to: '/plan', icon: Navigation, title: 'Route planner', text: 'Fastest, fewest-change, shortest or balanced routes with alternatives and timetable-aware journeys.' },
  { to: '/lab', icon: FlaskConical, title: 'Algorithm lab', text: 'Step through real execution traces of Greedy Best-First, BFS, Dijkstra and A* on the live network.' },
  { to: '/compare', icon: GitCompareArrows, title: 'Compare', text: 'Run algorithms on identical inputs and compare cost, expansions, timing and optimality gaps.' },
  { to: '/explore', icon: MapIcon, title: 'Network explorer', text: 'Inspect stations, lines, connections, first/last departures and nearby stations.' },
  { to: '/analytics', icon: BarChart3, title: 'Analytics', text: 'Topology metrics — degree, betweenness, components — and benchmark results.' },
  { to: '/data', icon: Database, title: 'Dataset', text: 'GTFS import, validation reports, versions and rollback.' },
]

export default function Landing() {
  const meta = useMeta()
  const network = useNetworkMap()
  const navigate = useNavigate()
  const [from, setFrom] = useState<StationSummary | null>(null)
  const [to, setTo] = useState<StationSummary | null>(null)
  const noData = meta.error instanceof ApiError && meta.error.code === 'no_dataset'

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6 lg:py-12">
      <section className="grid items-center gap-8 lg:grid-cols-[1.05fr_1fr]">
        <div className="space-y-6">
          <div className="space-y-3">
            <Badge tone="primary">Real GTFS data · genuine search algorithms</Badge>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Plan metro journeys and see <span className="text-primary">how the search thinks</span>.
            </h1>
            <p className="max-w-xl text-muted-foreground">
              MetroMind builds a transit graph from an imported GTFS feed, finds routes with Greedy Best-First Search, BFS, Dijkstra,
              A* and timetable-based Connection Scan, and shows every step it took.
            </p>
          </div>

          {noData ? (
            <Callout
              tone="warning"
              title="No dataset imported yet"
              action={
                <Link to="/data" className={buttonVariants({ size: 'sm' })}>
                  Go to dataset management
                </Link>
              }
            >
              Route planning is disabled until an administrator imports a GTFS feed. Nothing is faked in the meantime.
            </Callout>
          ) : (
            <Card className="space-y-2 p-3">
              <StationCombobox label="Origin" icon="origin" value={from} onChange={setFrom} placeholder="From station" />
              <StationCombobox label="Destination" icon="destination" value={to} onChange={setTo} placeholder="To station" />
              <Button
                className="w-full"
                disabled={!from || !to}
                onClick={() => navigate(`/plan?${new URLSearchParams({ from: from!.id, to: to!.id, obj: 'time', algo: 'auto', alt: '2' })}`)}
              >
                Find route <ArrowRight />
              </Button>
            </Card>
          )}

          {meta.data && (
            <dl className="tabular grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Stations', meta.data.counts.stations],
                ['Lines', meta.data.counts.lines],
                ['Track links', meta.data.counts.edges],
                ['Timetabled hops', meta.data.counts.connections],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="text-xl font-semibold">{fmtNumber(v as number)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <Card className="relative aspect-[4/3] overflow-hidden p-0">
          {network.data ? (
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <TransitMap network={network.data} showAllStations />
            </Suspense>
          ) : (
            <Skeleton className="h-full w-full rounded-none" />
          )}
          {meta.data && (
            <div className="absolute bottom-3 left-3 z-[500] max-w-[80%] rounded-md bg-card/95 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-pop">
              {meta.data.dataset.label} · {meta.data.timezone}
            </div>
          )}
        </Card>
      </section>

      <section aria-labelledby="features" className="space-y-4">
        <h2 id="features" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          What you can do
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ to, icon: Icon, title, text }) => (
            <Link key={to} to={to} className="group rounded-lg border bg-card p-4 shadow-card transition-colors hover:border-primary/40">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-accent p-1.5 text-accent-foreground">
                  <Icon className="size-4" />
                </span>
                <span className="font-medium">{title}</span>
                <ArrowRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{text}</p>
            </Link>
          ))}
        </div>
      </section>

      {meta.data && (
        <section className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <h2 className="text-sm font-semibold">Algorithms</h2>
            <ul className="mt-3 space-y-3">
              {meta.data.algorithms.map((a) => (
                <li key={a.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{a.name}</span>
                    <Badge tone={a.informed ? 'primary' : 'neutral'}>{a.informed ? 'informed' : 'uninformed'}</Badge>
                    <Badge tone="outline">optimal: {String(a.optimal)}</Badge>
                  </div>
                  <p className="mt-0.5 text-muted-foreground">{a.summary}</p>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">About the data</h2>
            <p className="text-sm text-muted-foreground">{meta.data.freshness.message}</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>Schedule-aware routing: {meta.data.capabilities.schedule.supported ? 'available within the calendar window' : 'unavailable'}</li>
              <li>Transfer timing data: {meta.data.capabilities.transfer_data ? 'provided by the feed' : 'not in feed — an adjustable assumption is used'}</li>
              <li>Fares: {meta.data.capabilities.fares ? 'available' : 'not in feed — not shown'}</li>
              <li>Accessibility data: {meta.data.capabilities.accessibility_data ? 'available' : 'not in feed — no claims are made'}</li>
              <li>Real-time positions & delays: not available — none are shown</li>
            </ul>
            {meta.data.attribution && <p className="text-xs text-muted-foreground">Source: {meta.data.attribution}</p>}
          </Card>
        </section>
      )}
    </div>
  )
}
