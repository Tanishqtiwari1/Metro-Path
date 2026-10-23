import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  Database,
  FlaskConical,
  GitCompareArrows,
  Code2,
  Map as MapIcon,
  MinusCircle,
  Navigation,
  Route,
  Sparkles,
  Zap,
} from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { lazy, Suspense, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { StationCombobox } from '@/components/StationCombobox'
import { AnimatedNumber, Badge, Button, buttonVariants, Callout, Kbd, Segmented, Skeleton } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { emit, modKey } from '@/lib/commands'
import { OBJECTIVE_LABELS } from '@/lib/format'
import { useMeta, useNetworkMap } from '@/lib/queries'
import type { AlgorithmInfo, Objective, StationSummary } from '@/lib/types'
import { cn } from '@/lib/utils'

const TransitMap = lazy(() => import('@/components/map/TransitMap').then((m) => ({ default: m.TransitMap })))

const REPO_URL = 'https://github.com/Tanishqtiwari1/Metro-Path'

function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

const FEATURES = [
  {
    to: '/plan',
    icon: Navigation,
    title: 'Route planner',
    text: 'Fastest, fewest-change, shortest or balanced routes, with alternatives, change limits and timetable journeys.',
    span: 'md:col-span-2',
  },
  { to: '/lab', icon: FlaskConical, title: 'Algorithm lab', text: 'Replay real search traces step by step on the live map.', span: '' },
  { to: '/compare', icon: GitCompareArrows, title: 'Compare', text: 'Run every algorithm on the same trip: cost, expansions, timing, optimality.', span: '' },
  { to: '/explore', icon: MapIcon, title: 'Network explorer', text: 'Stations, lines, first and last trains, nearby stops.', span: '' },
  { to: '/analytics', icon: BarChart3, title: 'Analytics', text: 'Hubs, connectivity, components and a seeded benchmark.', span: '' },
  { to: '/data', icon: Database, title: 'Transparent data', text: 'Every result names its source, assumptions and what the feed lacks.', span: 'md:col-span-2' },
]

function AlgorithmShowcase({ algorithms }: { algorithms: AlgorithmInfo[] }) {
  const [active, setActive] = useState(algorithms.find((a) => a.id === 'astar')?.id ?? algorithms[0]?.id)
  const a = algorithms.find((x) => x.id === active) ?? algorithms[0]
  if (!a) return null
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <div role="tablist" aria-label="Algorithms" className="flex gap-1.5 overflow-x-auto lg:flex-col">
        {algorithms.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={x.id === active}
            onClick={() => setActive(x.id)}
            className={cn(
              'relative shrink-0 cursor-pointer rounded-xl px-3.5 py-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
              x.id === active && 'text-foreground',
            )}
          >
            {x.id === active && (
              <motion.span layoutId="algo-tab" className="absolute inset-0 rounded-xl border bg-card shadow-card" transition={{ type: 'spring', stiffness: 450, damping: 38 }} />
            )}
            <span className="relative flex items-center justify-between gap-3">
              {x.name}
              <span className={cn('size-1.5 rounded-full', x.informed ? 'bg-primary' : 'bg-muted-foreground/50')} />
            </span>
          </button>
        ))}
      </div>
      <motion.div
        key={a.id}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-2xl border bg-card p-6 shadow-card"
        role="tabpanel"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold">{a.name}</h3>
          <Badge tone={a.informed ? 'primary' : 'neutral'}>{a.informed ? 'Informed (heuristic)' : 'Uninformed'}</Badge>
        </div>
        <p className="mt-3 max-w-2xl leading-relaxed text-muted-foreground">{a.summary}</p>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-muted/60 p-3">
            <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Optimal</dt>
            <dd className="mt-1 text-sm font-medium">{a.optimal === true ? 'Yes' : a.optimal === false ? 'No' : String(a.optimal)}</dd>
          </div>
          <div className="rounded-xl bg-muted/60 p-3">
            <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Complexity</dt>
            <dd className="mt-1 font-mono text-[13px]">{a.complexity}</dd>
          </div>
        </dl>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link to="/lab" className={buttonVariants({ size: 'sm' })}>
            <FlaskConical /> Watch it run
          </Link>
          <Link to="/compare" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
            <GitCompareArrows /> Compare with others
          </Link>
        </div>
      </motion.div>
    </div>
  )
}

export default function Landing() {
  const meta = useMeta()
  const network = useNetworkMap()
  const navigate = useNavigate()
  const [from, setFrom] = useState<StationSummary | null>(null)
  const [to, setTo] = useState<StationSummary | null>(null)
  const [objective, setObjective] = useState<Objective>('time')
  const noData = meta.error instanceof ApiError && meta.error.code === 'no_dataset'
  const m = meta.data

  const go = () => navigate(`/plan?${new URLSearchParams({ from: from!.id, to: to!.id, obj: objective, algo: 'auto', alt: '2' })}`)

  return (
    <div className="min-h-full">
      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden border-b">
        <div className="bg-dots pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top_left,black_20%,transparent_70%)]" />
        <div className="pointer-events-none absolute -left-40 -top-40 size-[520px] rounded-full bg-primary/15 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 top-20 size-[380px] rounded-full bg-violet-500/10 blur-3xl" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:py-20">
          <div className="space-y-7">
            <Reveal>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border bg-card/80 py-1 pl-1 pr-3 text-xs font-medium shadow-card backdrop-blur transition-colors hover:border-primary/40"
              >
                <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] text-primary-foreground">New</span>
                Real Delhi Metro GTFS · open source
                <ArrowRight className="size-3.5 text-muted-foreground" />
              </a>
            </Reveal>
            <Reveal delay={0.05}>
              <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.4rem]">
                Find the best way across the metro, <span className="text-gradient">and see how it was found.</span>
              </h1>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="max-w-xl text-[17px] leading-relaxed text-muted-foreground">
                MetroMind plans journeys on real transit data with A*, Dijkstra, BFS, Greedy Best-First and timetable-based Connection
                Scan. Then it shows every step the search took.
              </p>
            </Reveal>

            <Reveal delay={0.15}>
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
                  Route planning is disabled until a GTFS feed is imported. Nothing is faked in the meantime.
                </Callout>
              ) : (
                <form
                  className="glass max-w-xl space-y-3 rounded-2xl p-3"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (from && to) go()
                  }}
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    <StationCombobox label="Origin" icon="origin" value={from} onChange={setFrom} placeholder="From station" />
                    <StationCombobox label="Destination" icon="destination" value={to} onChange={setTo} placeholder="To station" />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Segmented
                      size="sm"
                      label="Optimise for"
                      value={objective}
                      onChange={setObjective}
                      className="flex-1"
                      options={(['time', 'transfers', 'stops'] as Objective[]).map((o) => ({ value: o, label: OBJECTIVE_LABELS[o] }))}
                    />
                    <Button type="submit" disabled={!from || !to} className="px-5">
                      <Route /> Find route
                    </Button>
                  </div>
                </form>
              )}
            </Reveal>

            <Reveal delay={0.2}>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
                <button type="button" onClick={() => emit('palette:open')} className="flex cursor-pointer items-center gap-1.5 hover:text-foreground">
                  <Kbd>{modKey}</Kbd>
                  <Kbd>K</Kbd> to search anything
                </button>
                <span className="flex items-center gap-1.5">
                  <Zap className="size-4 text-highlight" /> Results in milliseconds
                </span>
                <span className="flex items-center gap-1.5">
                  <Sparkles className="size-4 text-primary" /> Every assumption shown
                </span>
              </div>
            </Reveal>
          </div>

          <Reveal delay={0.1} className="relative">
            <div className="relative aspect-[5/4] overflow-hidden rounded-2xl border bg-card shadow-float">
              {network.data ? (
                <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
                  <TransitMap network={network.data} drawLines scrollZoom={false} showAllStations={false} />
                </Suspense>
              ) : (
                <Skeleton className="h-full w-full rounded-none" />
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-card/90 to-transparent" />
              {m && (
                <div className="glass absolute left-3 top-3 z-[500] flex items-center gap-2 rounded-xl px-3 py-2 text-xs">
                  <span className="size-2 rounded-full bg-success" />
                  <span className="font-medium">{m.dataset.label}</span>
                  <span className="text-muted-foreground">· {m.timezone}</span>
                </div>
              )}
            </div>
            {m && (
              <div className="glass absolute -bottom-5 -left-4 z-[500] hidden rounded-2xl px-4 py-3 sm:block">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Timetabled hops</div>
                <div className="text-2xl font-semibold tracking-tight">
                  <AnimatedNumber value={m.counts.connections} />
                </div>
              </div>
            )}
          </Reveal>
        </div>

        {m && (
          <div className="relative mx-auto max-w-7xl px-4 pb-10 sm:px-6">
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border shadow-card sm:grid-cols-4">
              {[
                ['Stations', m.counts.stations, MapIcon],
                ['Lines', m.counts.lines, Route],
                ['Track links', m.counts.edges, GitCompareArrows],
                ['Algorithms', m.algorithms.length, FlaskConical],
              ].map(([label, value, Icon]) => {
                const I = Icon as typeof MapIcon
                return (
                  <div key={label as string} className="bg-card px-5 py-4">
                    <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <I className="size-3.5" /> {label as string}
                    </dt>
                    <dd className="mt-1 text-2xl font-semibold tracking-tight">
                      <AnimatedNumber value={value as number} />
                    </dd>
                  </div>
                )
              })}
            </dl>
          </div>
        )}
      </section>

      {/* -------------------------------------------------------- features */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <Reveal>
          <div className="max-w-2xl">
            <div className="text-sm font-medium text-primary">Everything in one place</div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">From a single trip to the whole network</h2>
            <p className="mt-3 text-muted-foreground">Plan, inspect, compare and audit. Every view runs on the same real data and the same algorithms.</p>
          </div>
        </Reveal>
        <div className="mt-8 grid gap-3 md:grid-cols-4">
          {FEATURES.map(({ to, icon: Icon, title, text, span }, i) => (
            <Reveal key={to} delay={i * 0.04} className={span}>
              <Link
                to={to}
                className="group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-card p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-pop"
              >
                <div className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-primary/0 blur-2xl transition-colors duration-300 group-hover:bg-primary/15" />
                <span className="flex size-9 items-center justify-center rounded-xl border bg-accent text-accent-foreground">
                  <Icon className="size-4" />
                </span>
                <span className="mt-4 font-semibold">{title}</span>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{text}</p>
                <span className="mt-4 flex items-center gap-1 text-sm font-medium text-primary">
                  Open <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------ algorithms */}
      {m && (
        <section className="border-y bg-muted/30">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
            <Reveal>
              <div className="max-w-2xl">
                <div className="text-sm font-medium text-primary">How the search thinks</div>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight">Five algorithms, one honest comparison</h2>
                <p className="mt-3 text-muted-foreground">
                  Greedy search is fast but can be wrong. A* and Dijkstra are provably optimal. See the trade-off for yourself.
                </p>
              </div>
            </Reveal>
            <Reveal delay={0.05} className="mt-8">
              <AlgorithmShowcase algorithms={m.algorithms} />
            </Reveal>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------ data */}
      {m && (
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-2">
            <Reveal>
              <div className="text-sm font-medium text-primary">Built on real data</div>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">Nothing invented, everything labelled</h2>
              <p className="mt-3 leading-relaxed text-muted-foreground">{m.freshness.message}</p>
              {m.attribution && <p className="mt-4 text-xs text-muted-foreground">Source: {m.attribution}</p>}
              <Link to="/data" className={cn(buttonVariants({ variant: 'outline' }), 'mt-6')}>
                <Database /> View the validation report
              </Link>
            </Reveal>
            <Reveal delay={0.05}>
              <ul className="divide-y rounded-2xl border bg-card shadow-card">
                {[
                  ['Station locations & track geometry', true, 'From stops.txt and shapes.txt'],
                  ['Scheduled stop-to-stop times', true, `${m.counts.connections.toLocaleString()} timetabled hops`],
                  ['Timetable journeys by date', m.capabilities.schedule.supported, `Calendar ${m.capabilities.schedule.service_start} → ${m.capabilities.schedule.service_end}`],
                  ['Interchange walking times', m.capabilities.transfer_data, m.capabilities.transfer_data ? 'From transfers.txt' : 'Not in feed: an adjustable, labelled allowance is used'],
                  ['Fares', m.capabilities.fares, m.capabilities.fares ? 'From the feed' : 'Not in feed, so not shown'],
                  ['Accessibility', m.capabilities.accessibility_data, m.capabilities.accessibility_data ? 'From the feed' : 'Not in feed: no claims are made'],
                  ['Live positions & delays', m.capabilities.realtime, 'Not available, so none are shown'],
                ].map(([label, ok, note]) => (
                  <li key={label as string} className="flex items-start gap-3 px-4 py-3">
                    {ok ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Available" />
                    ) : (
                      <MinusCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Not available" />
                    )}
                    <div>
                      <div className="text-sm font-medium">{label as string}</div>
                      <div className="text-xs text-muted-foreground">{note as string}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------- CTA */}
      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary to-violet-600 px-6 py-12 text-center text-white shadow-float sm:px-12">
            <div className="bg-dots pointer-events-none absolute inset-0 opacity-20" />
            <h2 className="relative text-3xl font-semibold tracking-tight">Plan your first route</h2>
            <p className="relative mx-auto mt-3 max-w-lg text-white/80">Pick two stations and get the route, the alternatives and the reasoning in under a second.</p>
            <div className="relative mt-6 flex flex-wrap justify-center gap-3">
              <Link to="/plan" className={cn(buttonVariants({ size: 'lg' }), 'bg-white text-primary hover:bg-white/90')}>
                <Navigation /> Open the planner
              </Link>
              <Link to="/lab" className={cn(buttonVariants({ size: 'lg', variant: 'ghost' }), 'text-white hover:bg-white/10')}>
                <Clock3 /> Watch a search
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>MetroMind · Not affiliated with or endorsed by DMRC. Map © OpenStreetMap contributors.</span>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-foreground">
            <Code2 className="size-4" /> Source on GitHub
          </a>
        </div>
      </footer>
    </div>
  )
}
