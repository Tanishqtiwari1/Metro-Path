import { ArrowRightLeft, ChevronDown, Clock, Footprints, Info, Ruler, TrainFront, Waypoints } from 'lucide-react'
import { useState } from 'react'
import { Badge, Stat, Tip } from '@/components/ui'
import { ALGO_SHORT, fmtCost, fmtDistance, fmtDuration, fmtMs, fmtNumber, hex } from '@/lib/format'
import type { JourneyStation, PlanResponse, Ride, ScheduleJourney, SearchStats, StaticJourney } from '@/lib/types'
import { cn } from '@/lib/utils'
import { LineChip } from '../LineChip'

export function isSchedule(j: StaticJourney | ScheduleJourney): j is ScheduleJourney {
  return (j as ScheduleJourney).mode === 'schedule'
}

export function ridesOf(j: StaticJourney | ScheduleJourney): Ride[] {
  return isSchedule(j) ? j.legs : j.rides
}

export function JourneyMetrics({ journey }: { journey: StaticJourney | ScheduleJourney }) {
  if (isSchedule(journey)) {
    const m = journey.metrics
    return (
      <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
        <Stat label="Journey" value={fmtDuration(m.total_time_s)} hint={`${m.departure.slice(0, 5)} → ${m.arrival.slice(0, 5)}`} />
        <Stat label="Changes" value={m.transfers} hint={`min. ${fmtDuration(m.min_transfer_s)} connection`} />
        <Stat label="Stops" value={m.stops} />
        <Stat label="Waiting" value={fmtDuration(m.waiting_s)} hint={`in train ${fmtDuration(m.in_vehicle_s)}`} />
      </div>
    )
  }
  const m = journey.metrics
  const est = m.distance_basis.includes('straight_line_estimate')
  return (
    <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
      <Stat
        label="Est. travel time"
        value={fmtDuration(m.total_time_s)}
        hint={m.transfer_allowance_s ? `incl. ${fmtDuration(m.transfer_allowance_s)} assumed changes` : 'scheduled ride time'}
      />
      <Stat label="Changes" value={m.transfers} hint={m.line_changes !== m.transfers ? `${m.line_changes} line changes` : undefined} />
      <Stat label="Stops" value={m.stops} hint={`${m.stations_visited} stations`} />
      <Stat
        label="Distance"
        value={fmtDistance(m.distance_m)}
        hint={est ? 'partly straight-line estimate' : m.distance_m != null ? 'track distance (shapes)' : 'unknown'}
      />
    </div>
  )
}

function StationList({ ids, names, roles }: { ids: string[]; names: Map<string, string>; roles: Map<string, string> }) {
  return (
    <ol className="space-y-0.5 py-1">
      {ids.map((id) => (
        <li key={id} className={cn('text-[13px]', roles.get(id) !== 'pass' ? 'font-medium' : 'text-muted-foreground')}>
          {names.get(id) ?? id}
        </li>
      ))}
    </ol>
  )
}

export function JourneyTimeline({
  journey,
  onHoverRide,
}: {
  journey: StaticJourney | ScheduleJourney
  onHoverRide?: (i: number | null) => void
}) {
  const names = new Map(journey.stations.map((s: JourneyStation) => [s.id, s.name]))
  const roles = new Map(journey.stations.map((s: JourneyStation) => [s.id, s.role]))
  const rides = ridesOf(journey)
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const schedule = isSchedule(journey)
  const transferInfo = !schedule ? (journey as StaticJourney).transfers_detail : []

  if (rides.length === 0)
    return <p className="text-sm text-muted-foreground">Origin and destination are the same station — no travel needed.</p>

  return (
    <ol className="relative">
      {rides.map((r, i) => {
        const open = openIdx === i
        const inner = r.stations.slice(1, -1)
        return (
          <li key={i} onMouseEnter={() => onHoverRide?.(i)} onMouseLeave={() => onHoverRide?.(null)} onFocus={() => onHoverRide?.(i)} onBlur={() => onHoverRide?.(null)}>
            {i > 0 && (
              <div className="flex items-center gap-3 py-2 pl-[3px] text-xs text-muted-foreground">
                <span className="flex size-5 items-center justify-center rounded-full border border-dashed">
                  <Footprints className="size-3" aria-hidden />
                </span>
                <span>
                  Change at <span className="font-medium text-foreground">{names.get(r.from_station)}</span>
                  {schedule
                    ? ` · wait ${fmtDuration(r.wait_before_s ?? 0)}`
                    : transferInfo[i - 1] &&
                      ` · ${fmtDuration(transferInfo[i - 1].seconds)} ${transferInfo[i - 1].source === 'assumed' ? '(assumed allowance)' : '(from transfers.txt)'}`}
                </span>
              </div>
            )}
            <div className="flex gap-3">
              <div className="flex w-[26px] shrink-0 flex-col items-center">
                <span className="mt-1 size-3 rounded-full border-[3px] bg-card" style={{ borderColor: hex(r.color) }} />
                <span className="w-1 flex-1 rounded-full" style={{ background: hex(r.color) }} />
                <span className="mb-1 size-3 rounded-full border-[3px] bg-card" style={{ borderColor: hex(r.color) }} />
              </div>
              <div className="min-w-0 flex-1 pb-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{names.get(r.from_station)}</span>
                  {r.departure && <span className="tabular shrink-0 text-sm font-medium">{r.departure.slice(0, 5)}</span>}
                </div>
                <div className="my-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <LineChip name={r.line_name} color={r.color} />
                  <span className="truncate" title={r.route_long_name}>
                    towards {r.route_long_name.replace(/^[^_]*_/, '').split(' to ').pop()}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenIdx(open ? null : i)}
                  aria-expanded={open}
                  className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
                  {r.hops} stop{r.hops === 1 ? '' : 's'} · {fmtDuration(r.ride_time_s)}
                  {r.distance_m != null && ` · ${fmtDistance(r.distance_m)}`}
                </button>
                {open && inner.length > 0 && (
                  <div className="ml-1 border-l pl-3">
                    <StationList ids={inner} names={names} roles={roles} />
                  </div>
                )}
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{names.get(r.to_station)}</span>
                  {r.arrival && <span className="tabular shrink-0 text-sm font-medium">{r.arrival.slice(0, 5)}</span>}
                </div>
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function SearchStatsCard({ plan }: { plan: PlanResponse }) {
  const s: SearchStats | null = plan.search
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="primary">
          <Waypoints className="size-3" /> {s?.algorithm_name ?? ALGO_SHORT[plan.algorithm]}
        </Badge>
        {plan.request.algorithm === 'auto' && <Badge tone="outline">auto-selected</Badge>}
        {plan.mode === 'schedule' && <Badge tone="outline">timetable · {plan.journey.service_date}</Badge>}
      </div>
      {plan.selection_reason && <p className="text-muted-foreground">{plan.selection_reason}</p>}
      {s && (
        <dl className="tabular grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          <dt className="text-muted-foreground">Search time</dt>
          <dd className="font-medium sm:col-span-2">{fmtMs(s.runtime_ms)}</dd>
          {s.expanded != null && (
            <>
              <dt className="text-muted-foreground">
                <Tip content="States removed from the frontier and expanded.">
                  <span className="cursor-help underline decoration-dotted">Expanded</span>
                </Tip>
              </dt>
              <dd className="font-medium sm:col-span-2">{fmtNumber(s.expanded)}</dd>
              <dt className="text-muted-foreground">
                <Tip content="Distinct states ever placed on the frontier (explored set). Route-aware searches count each (station, route) state separately.">
                  <span className="cursor-help underline decoration-dotted">Explored</span>
                </Tip>
              </dt>
              <dd className="font-medium sm:col-span-2">
                {fmtNumber(s.discovered)} <span className="text-muted-foreground">({fmtNumber(s.generated)} pushes)</span>
              </dd>
            </>
          )}
          {s.connections_scanned != null && (
            <>
              <dt className="text-muted-foreground">Connections scanned</dt>
              <dd className="font-medium sm:col-span-2">{fmtNumber(s.connections_scanned)}</dd>
            </>
          )}
          {plan.mode === 'static' && (
            <>
              <dt className="text-muted-foreground">Objective cost</dt>
              <dd className="font-medium sm:col-span-2">
                {fmtCost(plan.journey.metrics.objective_cost, plan.journey.metrics.objective_unit)}
              </dd>
            </>
          )}
        </dl>
      )}
      <p className="text-muted-foreground">{plan.objective_description}</p>
    </div>
  )
}

export function AssumptionList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5 text-xs text-muted-foreground">
      {items.map((a) => (
        <li key={a} className="flex gap-2">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{a}</span>
        </li>
      ))}
    </ul>
  )
}

export function AlternativeCard({
  alt,
  index,
  selected,
  onSelect,
}: {
  alt: StaticJourney
  index: number
  selected: boolean
  onSelect: () => void
}) {
  const m = alt.metrics
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'w-full cursor-pointer rounded-md border bg-card p-3 text-left transition-colors hover:bg-muted/60',
        selected && 'border-primary ring-1 ring-primary',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">Alternative {index + 1}</span>
        <span className="text-xs text-muted-foreground">{alt.tradeoff}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {alt.rides.map((r, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ArrowRightLeft className="size-3 text-muted-foreground" aria-hidden />}
            <LineChip name={r.line_name} color={r.color} />
          </span>
        ))}
      </div>
      <div className="tabular mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="size-3" />
          {fmtDuration(m.total_time_s)}
        </span>
        <span className="flex items-center gap-1">
          <TrainFront className="size-3" />
          {m.transfers} change{m.transfers === 1 ? '' : 's'}
        </span>
        <span>{m.stops} stops</span>
        <span className="flex items-center gap-1">
          <Ruler className="size-3" />
          {fmtDistance(m.distance_m)}
        </span>
      </div>
    </button>
  )
}
