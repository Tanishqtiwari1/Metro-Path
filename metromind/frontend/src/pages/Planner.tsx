import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownUp,
  Check,
  Clock3,
  Download,
  History,
  Link2,
  RotateCcw,
  Route as RouteIcon,
  SlidersHorizontal,
  Star,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DataGate } from '@/components/DataGate'
import { AlternativeCard, AssumptionList, JourneyMetrics, JourneyTimeline, ridesOf, SearchStatsCard } from '@/components/journey/Journey'
import { MapLegend } from '@/components/map/MapLegend'
import { TransitMap, type RouteOverlay } from '@/components/map/TransitMap'
import { StationCombobox } from '@/components/StationCombobox'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  NativeSelect,
  Segmented,
  Skeleton,
  Slider,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import { ALGO_SHORT, fmtDate, OBJECTIVE_LABELS } from '@/lib/format'
import { usePrefs } from '@/lib/prefs'
import { useNetworkMap } from '@/lib/queries'
import { buildShare, parseShare } from '@/lib/share'
import type { AlgorithmChoice, Meta, Objective, PlanRequest, PlanResponse, SavedRoute, StationSummary, StaticJourney } from '@/lib/types'
import { downloadBlob } from '@/lib/utils'

type TimeMode = 'static' | 'depart'
const OBJECTIVE_SHORT: Record<Objective, string> = {
  time: 'Fastest',
  transfers: 'Fewest changes',
  stops: 'Fewest stops',
  distance: 'Shortest',
  balanced: 'Balanced',
}

export default function PlannerPage() {
  return <DataGate>{(meta) => <Planner meta={meta} />}</DataGate>
}

function Planner({ meta }: { meta: Meta }) {
  const { prefs } = usePrefs()
  const [params, setParams] = useSearchParams()
  const network = useNetworkMap()
  const qc = useQueryClient()

  const [origin, setOrigin] = useState<StationSummary | null>(null)
  const [destination, setDestination] = useState<StationSummary | null>(null)
  const [objective, setObjective] = useState<Objective>(prefs.objective)
  const [algorithm, setAlgorithm] = useState<AlgorithmChoice>(prefs.algorithm)
  const [maxTransfers, setMaxTransfers] = useState<number | null>(null)
  const [penalty, setPenalty] = useState<number>(prefs.transferPenaltyS ?? meta.defaults.transfer_penalty_s)
  const [wTransfer, setWTransfer] = useState(prefs.wTransferMin)
  const [wStop, setWStop] = useState(prefs.wStopMin)
  const [alternatives, setAlternatives] = useState(prefs.alternatives)
  const [timeMode, setTimeMode] = useState<TimeMode>('static')
  const [date, setDate] = useState(meta.local_now.slice(0, 10))
  const [time, setTime] = useState(meta.local_now.slice(11, 16))
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [selectedAlt, setSelectedAlt] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const loadedFromUrl = useRef(false)

  const plan = useMutation({
    mutationFn: (req: PlanRequest) => api.plan(req),
    onSuccess: () => {
      setSelectedAlt(null)
      qc.invalidateQueries({ queryKey: ['saved', 'history'] })
    },
  })

  const buildRequest = (o = origin, d = destination): PlanRequest | null => {
    if (!o || !d) return null
    return {
      origin: o.id,
      destination: d.id,
      objective,
      algorithm: timeMode === 'depart' && algorithm === 'auto' ? 'auto' : algorithm,
      max_transfers: maxTransfers,
      transfer_penalty_s: penalty,
      w_transfer_min: wTransfer,
      w_stop_min: wStop,
      alternatives: timeMode === 'depart' ? 0 : alternatives,
      depart_date: timeMode === 'depart' ? date : null,
      depart_time: timeMode === 'depart' ? time : null,
      min_transfer_s: prefs.minTransferS,
      record_history: prefs.recordHistory,
    }
  }

  const submit = (o = origin, d = destination) => {
    const req = buildRequest(o, d)
    if (!req) return
    setParams(buildShare(req), { replace: true })
    plan.mutate(req)
  }

  // Load a shared URL once: validate params, resolve station ids against the API, then search.
  useEffect(() => {
    if (loadedFromUrl.current) return
    loadedFromUrl.current = true
    const { state, rejected } = parseShare(params)
    if (rejected.length) setNotice(`Ignored invalid link parameter(s): ${rejected.join(', ')}.`)
    if (state.objective) setObjective(state.objective)
    if (state.algorithm) setAlgorithm(state.algorithm)
    if (state.maxTransfers !== undefined) setMaxTransfers(state.maxTransfers)
    if (state.transferPenaltyS != null) setPenalty(state.transferPenaltyS)
    if (state.alternatives !== undefined) setAlternatives(state.alternatives)
    if (state.wTransferMin !== undefined) setWTransfer(state.wTransferMin)
    if (state.wStopMin !== undefined) setWStop(state.wStopMin)
    if (state.date && state.time) {
      setTimeMode('depart')
      setDate(state.date)
      setTime(state.time)
    }
    if (state.origin && state.destination) {
      Promise.all([api.station(state.origin), api.station(state.destination)])
        .then(([o, d]) => {
          setOrigin(o)
          setDestination(d)
          const req: PlanRequest = {
            origin: o.id,
            destination: d.id,
            objective: state.objective ?? prefs.objective,
            algorithm: state.algorithm ?? prefs.algorithm,
            max_transfers: state.maxTransfers ?? null,
            transfer_penalty_s: state.transferPenaltyS ?? prefs.transferPenaltyS ?? meta.defaults.transfer_penalty_s,
            w_transfer_min: state.wTransferMin ?? prefs.wTransferMin,
            w_stop_min: state.wStopMin ?? prefs.wStopMin,
            alternatives: state.date ? 0 : (state.alternatives ?? prefs.alternatives),
            depart_date: state.date ?? null,
            depart_time: state.time ?? null,
            min_transfer_s: prefs.minTransferS,
            record_history: false,
          }
          plan.mutate(req)
        })
        .catch(() => setNotice('A station in this link does not exist in the active dataset.'))
    } else if (state.origin || state.destination) {
      const id = (state.origin ?? state.destination)!
      api
        .station(id)
        .then((s) => (state.origin ? setOrigin(s) : setDestination(s)))
        .catch(() => setNotice('The station in this link does not exist in the active dataset.'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scheduleStatus = useQuery({
    queryKey: ['schedule-status', date],
    queryFn: () => api.scheduleStatus(date),
    enabled: timeMode === 'depart' && /^\d{4}-\d{2}-\d{2}$/.test(date),
  })

  const result = plan.data
  const shown: StaticJourney | PlanResponse['journey'] | null = useMemo(() => {
    if (!result) return null
    if (result.mode === 'static' && selectedAlt != null) return result.alternatives[selectedAlt]
    return result.journey
  }, [result, selectedAlt])

  const overlays: RouteOverlay[] = useMemo(() => {
    if (!result) return []
    const out: RouteOverlay[] = []
    if (result.mode === 'static') {
      result.alternatives.forEach((a, i) => {
        if (i !== selectedAlt) out.push({ key: `alt-${i}`, rides: a.rides, stations: a.stations, muted: true, dashed: true, color: '64748b' })
      })
      if (selectedAlt != null)
        out.push({ key: 'primary-muted', rides: result.journey.rides, stations: result.journey.stations, muted: true, dashed: true, color: '64748b' })
    }
    if (shown) out.push({ key: `main-${selectedAlt ?? 'p'}`, rides: ridesOf(shown), stations: shown.stations })
    return out
  }, [result, shown, selectedAlt])

  const swap = () => {
    setOrigin(destination)
    setDestination(origin)
  }

  const reset = () => {
    setOrigin(null)
    setDestination(null)
    setObjective(prefs.objective)
    setAlgorithm(prefs.algorithm)
    setMaxTransfers(null)
    setPenalty(prefs.transferPenaltyS ?? meta.defaults.transfer_penalty_s)
    setAlternatives(prefs.alternatives)
    setTimeMode('static')
    plan.reset()
    setParams({}, { replace: true })
    setNotice(null)
  }

  const share = async () => {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setNotice(`Copy this link: ${url}`)
    }
  }

  const saveFav = useMutation({
    mutationFn: () => {
      const req = buildRequest()!
      const { origin: o, destination: d, ...rest } = req
      return api.save({ origin: o, destination: d, params: rest, label: `${origin!.name} → ${destination!.name}` })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved', 'favorite'] }),
  })

  const exportAs = async (format: 'csv' | 'json') => {
    const req = buildRequest()
    if (!req) return
    try {
      const { blob, name } = await api.exportRoute({ ...req, record_history: false, format })
      downloadBlob(blob, name)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Export failed')
    }
  }

  const loadSaved = (s: SavedRoute) => {
    const o = network.data?.stations.find((x) => x.id === s.origin_id)
    const d = network.data?.stations.find((x) => x.id === s.destination_id)
    if (!o || !d) {
      setNotice('That saved route refers to stations not present in the active dataset.')
      return
    }
    const p = s.params
    if (p.objective) setObjective(p.objective)
    if (p.algorithm) setAlgorithm(p.algorithm)
    setMaxTransfers(p.max_transfers ?? null)
    if (p.transfer_penalty_s != null) setPenalty(p.transfer_penalty_s)
    setOrigin(o)
    setDestination(d)
    const req: PlanRequest = { ...(buildRequest(o, d) as PlanRequest), ...p, origin: o.id, destination: d.id }
    if (req.depart_date) setTimeMode('depart')
    setParams(buildShare(req), { replace: true })
    plan.mutate(req)
  }

  const objectiveCaps = new Map(meta.capabilities.objectives.map((o) => [o.id, o]))
  const scheduleOk = meta.capabilities.schedule.supported
  const err = plan.error as ApiError | null

  return (
    <div className="flex h-full flex-col lg:grid lg:grid-cols-[minmax(360px,440px)_1fr]">
      <section aria-label="Route search" className="@container order-2 flex min-h-0 flex-col border-r lg:order-1 lg:overflow-y-auto">
        <form
          className="space-y-3 border-b p-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold">Plan a journey</h1>
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw /> Reset
            </Button>
          </div>
          <div className="relative space-y-2">
            <StationCombobox label="Origin" icon="origin" value={origin} onChange={setOrigin} placeholder="From station" />
            <StationCombobox label="Destination" icon="destination" value={destination} onChange={setDestination} placeholder="To station" />
            <Button
              variant="outline"
              size="icon-sm"
              className="absolute right-10 top-[26px] z-10 rounded-full bg-card"
              aria-label="Swap origin and destination"
              onClick={swap}
            >
              <ArrowDownUp />
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label>Optimise for</Label>
            <Segmented
              label="Optimisation objective"
              value={objective}
              onChange={setObjective}
              options={(['time', 'transfers', 'stops', 'distance', 'balanced'] as Objective[]).map((o) => ({
                value: o,
                label: OBJECTIVE_SHORT[o],
                disabled: objectiveCaps.get(o)?.supported === false,
                title: objectiveCaps.get(o)?.reason ?? objectiveCaps.get(o)?.description,
              }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>When</Label>
            <Segmented
              label="Timing mode"
              value={timeMode}
              onChange={(v) => {
                setTimeMode(v)
                if (v === 'static' && algorithm === 'csa') setAlgorithm('auto')
              }}
              options={[
                { value: 'static', label: 'Any time (typical)' },
                { value: 'depart', label: 'Depart at…', disabled: !scheduleOk, title: meta.capabilities.schedule.reason ?? undefined },
              ]}
            />
            {timeMode === 'depart' && (
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" aria-label="Departure date" value={date} onChange={(e) => setDate(e.target.value)} required />
                <Input type="time" aria-label="Departure time" value={time} onChange={(e) => setTime(e.target.value)} required />
              </div>
            )}
            {timeMode === 'depart' && scheduleStatus.data && !scheduleStatus.data.has_service && (
              <Callout
                tone="warning"
                title={scheduleStatus.data.in_validity_window ? 'No scheduled trips on this date' : 'Date outside the timetable'}
                action={
                  scheduleStatus.data.suggested_date && (
                    <Button size="sm" variant="outline" onClick={() => setDate(scheduleStatus.data!.suggested_date!)}>
                      Use {fmtDate(scheduleStatus.data.suggested_date)}
                    </Button>
                  )
                }
              >
                The feed's calendar covers {scheduleStatus.data.service_start} to {scheduleStatus.data.service_end}. MetroMind won't
                invent a timetable for other dates. Times are in {meta.timezone ?? 'the feed timezone'}.
              </Callout>
            )}
          </div>

          <button
            type="button"
            className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((s) => !s)}
          >
            <SlidersHorizontal className="size-3.5" /> {showAdvanced ? 'Hide' : 'Show'} algorithm & preferences
          </button>

          {showAdvanced && (
            <div className="space-y-3 rounded-md border bg-muted/40 p-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="algo">Algorithm</Label>
                  <NativeSelect id="algo" value={algorithm} onChange={(e) => setAlgorithm(e.target.value as AlgorithmChoice)}>
                    <option value="auto">Auto (recommended)</option>
                    <option value="astar">A*</option>
                    <option value="dijkstra">Dijkstra</option>
                    <option value="bfs">Breadth-first</option>
                    <option value="gbfs">Greedy best-first</option>
                    <option value="csa" disabled={timeMode !== 'depart'}>
                      Connection scan (timetable)
                    </option>
                  </NativeSelect>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="mt">Max changes</Label>
                  <NativeSelect
                    id="mt"
                    value={maxTransfers ?? 'any'}
                    disabled={timeMode === 'depart'}
                    onChange={(e) => setMaxTransfers(e.target.value === 'any' ? null : Number(e.target.value))}
                  >
                    <option value="any">Any</option>
                    {[0, 1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <Label>Change allowance (assumed)</Label>
                  <span className="tabular text-muted-foreground">{Math.round(penalty / 60)} min</span>
                </div>
                <Slider label="Change allowance" min={0} max={900} step={30} value={[penalty]} onValueChange={([v]) => setPenalty(v)} />
                {!meta.capabilities.transfer_data && (
                  <p className="text-[11px] text-muted-foreground">The feed has no transfer timing data; this is your assumption.</p>
                )}
              </div>
              {objective === 'balanced' && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="wt">Minutes per change</Label>
                    <Input id="wt" type="number" min={0} max={120} step={0.5} value={wTransfer} onChange={(e) => setWTransfer(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ws">Minutes per stop</Label>
                    <Input id="ws" type="number" min={0} max={30} step={0.1} value={wStop} onChange={(e) => setWStop(Number(e.target.value))} />
                  </div>
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="alts">Alternative routes</Label>
                <NativeSelect id="alts" value={alternatives} disabled={timeMode === 'depart'} onChange={(e) => setAlternatives(Number(e.target.value))}>
                  {Array.from({ length: meta.defaults.max_alternatives + 1 }, (_, n) => (
                    <option key={n} value={n}>
                      {n === 0 ? 'None' : n}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
          )}

          <Button type="submit" className="w-full" size="lg" disabled={!origin || !destination} loading={plan.isPending}>
            <RouteIcon /> Find route
          </Button>
          {notice && (
            <Callout tone="warning" action={<Button size="sm" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>}>
              {notice}
            </Callout>
          )}
        </form>

        <div className="flex-1 space-y-3 p-4">
          {plan.isPending && (
            <div className="space-y-2" aria-live="polite" aria-busy>
              <Skeleton className="h-16" />
              <Skeleton className="h-48" />
            </div>
          )}
          {err && !plan.isPending && (
            <Callout
              tone="danger"
              title={
                {
                  unreachable: 'No route exists',
                  transfer_limit: 'No route within the change limit',
                  no_service_on_date: 'No timetabled service',
                  no_scheduled_journey: 'No timetabled journey',
                  network_error: 'API unreachable',
                }[err.code] ?? 'Could not plan this route'
              }
              action={
                (err.code === 'no_service_on_date' || err.code === 'no_scheduled_journey') &&
                typeof err.details.suggested_date === 'string' ? (
                  <Button size="sm" variant="outline" onClick={() => setDate(err.details.suggested_date as string)}>
                    Use {String(err.details.suggested_date)}
                  </Button>
                ) : err.code === 'transfer_limit' ? (
                  <Button size="sm" variant="outline" onClick={() => setMaxTransfers(null)}>
                    Remove limit
                  </Button>
                ) : undefined
              }
            >
              {err.message}
            </Callout>
          )}
          {result && shown && !plan.isPending && (
            <ResultPanel
              result={result}
              shown={shown}
              selectedAlt={selectedAlt}
              setSelectedAlt={setSelectedAlt}
              onShare={share}
              copied={copied}
              onSave={() => saveFav.mutate()}
              saved={saveFav.isSuccess}
              saving={saveFav.isPending}
              onExport={exportAs}
            />
          )}
          {!result && !plan.isPending && !err && <SavedPanel onLoad={loadSaved} />}
        </div>
      </section>

      <section aria-label="Map" className="relative order-1 h-[42vh] shrink-0 lg:order-2 lg:h-full">
        {network.data ? (
          <TransitMap
            network={network.data}
            routes={overlays}
            onStationClick={(id) => {
              const s = network.data!.stations.find((x) => x.id === id)
              if (!s) return
              if (!origin) setOrigin(s)
              else if (!destination && s.id !== origin.id) setDestination(s)
            }}
            fitKey={result ? `${result.request.origin}-${result.request.destination}-${selectedAlt}-${result.algorithm}` : 'network'}
          />
        ) : (
          <Skeleton className="h-full w-full rounded-none" />
        )}
        {network.data && (
          <div className="absolute bottom-6 right-3 z-[500] hidden sm:block">
            <MapLegend lines={network.data.lines} collapsible />
          </div>
        )}
        {!origin && network.data && (
          <div className="absolute left-14 top-3 z-[500] rounded-md bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-pop">
            Tip: click a station on the map to set the origin, then the destination.
          </div>
        )}
      </section>
    </div>
  )
}

function ResultPanel({
  result,
  shown,
  selectedAlt,
  setSelectedAlt,
  onShare,
  copied,
  onSave,
  saved,
  saving,
  onExport,
}: {
  result: PlanResponse
  shown: PlanResponse['journey'] | StaticJourney
  selectedAlt: number | null
  setSelectedAlt: (i: number | null) => void
  onShare: () => void
  copied: boolean
  onSave: () => void
  saved: boolean
  saving: boolean
  onExport: (f: 'csv' | 'json') => void
}) {
  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="outline" onClick={onSave} loading={saving} disabled={saved}>
          {saved ? <Check /> : <Star />} {saved ? 'Saved' : 'Save'}
        </Button>
        <Button size="sm" variant="outline" onClick={onShare}>
          {copied ? <Check /> : <Link2 />} {copied ? 'Link copied' : 'Share'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onExport('csv')}>
          <Download /> CSV
        </Button>
        <Button size="sm" variant="outline" onClick={() => onExport('json')}>
          <Download /> JSON
        </Button>
      </div>

      {result.warnings?.map((w) => (
        <Callout key={w} tone="warning">
          {w}
        </Callout>
      ))}
      {result.notes?.map((w) => (
        <Callout key={w} tone="info">
          {w}
        </Callout>
      ))}

      <JourneyMetrics journey={shown} />

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{selectedAlt == null ? 'Recommended route' : `Alternative ${selectedAlt + 1}`}</CardTitle>
          {selectedAlt != null && (
            <Button size="sm" variant="link" onClick={() => setSelectedAlt(null)}>
              Back to recommended
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <JourneyTimeline journey={shown} />
        </CardContent>
      </Card>

      {result.mode === 'static' && result.alternatives.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Alternatives</h2>
          {result.alternatives.map((a, i) => (
            <AlternativeCard key={i} alt={a} index={i} selected={selectedAlt === i} onSelect={() => setSelectedAlt(selectedAlt === i ? null : i)} />
          ))}
        </div>
      )}
      {result.mode === 'static' && result.request.alternatives! > 0 && result.alternatives.length === 0 && (
        <p className="text-xs text-muted-foreground">No meaningfully different alternative was found for this trip.</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>How this route was found</CardTitle>
        </CardHeader>
        <CardContent>
          <SearchStatsCard plan={result} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assumptions & data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <AssumptionList items={result.assumptions} />
          <div className="border-t pt-2 text-[11px] text-muted-foreground">
            Dataset #{result.dataset.id} · {result.dataset.label} · imported {fmtDate(result.dataset.imported_at)}
            <br />
            {result.dataset.freshness.message}
            {result.dataset.attribution && (
              <>
                <br />
                Source: {result.dataset.attribution}
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function SavedPanel({ onLoad }: { onLoad: (s: SavedRoute) => void }) {
  const qc = useQueryClient()
  const favs = useQuery({ queryKey: ['saved', 'favorite'], queryFn: () => api.saved('favorite') })
  const hist = useQuery({ queryKey: ['saved', 'history'], queryFn: () => api.saved('history') })
  const del = useMutation({
    mutationFn: (id: number) => api.deleteSaved(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved'] }),
  })
  const clear = useMutation({ mutationFn: api.clearHistory, onSuccess: () => qc.invalidateQueries({ queryKey: ['saved', 'history'] }) })

  const list = (items: SavedRoute[] | undefined, empty: string, kind: 'favorite' | 'history') =>
    !items ? (
      <Skeleton className="h-24" />
    ) : items.length === 0 ? (
      <EmptyState icon={kind === 'favorite' ? <Star /> : <History />} title={empty} />
    ) : (
      <ul className="divide-y rounded-md border bg-card">
        {items.map((s) => (
          <li key={s.id} className="flex items-center gap-2 px-3 py-2">
            <button type="button" className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => onLoad(s)}>
              <div className="truncate text-sm font-medium">
                {s.origin_name} → {s.destination_name}
              </div>
              <div className="flex flex-wrap gap-1 pt-0.5 text-[11px] text-muted-foreground">
                <span>{OBJECTIVE_LABELS[s.params.objective ?? 'time']}</span>
                <span>· {ALGO_SHORT[s.params.algorithm ?? 'auto']}</span>
                {s.params.depart_date && (
                  <span className="flex items-center gap-0.5">
                    · <Clock3 className="size-3" /> {s.params.depart_date} {s.params.depart_time}
                  </span>
                )}
                <span>· {fmtDate(s.created_at)}</span>
              </div>
            </button>
            <Button size="icon-sm" variant="ghost" aria-label="Delete" onClick={() => del.mutate(s.id)}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
    )

  return (
    <Tabs defaultValue="favorite">
      <div className="flex items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="favorite">
            <Star className="size-3.5" /> Saved
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="size-3.5" /> Recent
          </TabsTrigger>
        </TabsList>
        {(hist.data?.length ?? 0) > 0 && (
          <Button size="sm" variant="ghost" onClick={() => clear.mutate()}>
            Clear recent
          </Button>
        )}
      </div>
      <TabsContent value="favorite" className="pt-3">
        {list(favs.data, 'No saved routes yet', 'favorite')}
      </TabsContent>
      <TabsContent value="history" className="pt-3">
        {list(hist.data, 'No recent searches', 'history')}
        <p className="mt-2 text-[11px] text-muted-foreground">
          <Badge tone="outline">private</Badge> Stored on the server under an anonymous id for this browser only.
        </p>
      </TabsContent>
    </Tabs>
  )
}
