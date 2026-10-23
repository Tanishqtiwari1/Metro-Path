import { useQuery } from '@tanstack/react-query'
import { Crosshair, LocateFixed, MapPin, Navigation, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { DataGate } from '@/components/DataGate'
import { LineChip, LineDots } from '@/components/LineChip'
import { MapLegend } from '@/components/map/MapLegend'
import { TransitMap } from '@/components/map/TransitMap'
import { StationCombobox } from '@/components/StationCombobox'
import { Badge, Button, buttonVariants, Callout, Card, CardContent, CardHeader, CardTitle, EmptyState, Label, Skeleton, Slider } from '@/components/ui'
import { api } from '@/lib/api'
import { fmtDistance, fmtDuration } from '@/lib/format'
import { useNetworkMap } from '@/lib/queries'
import type { StationSummary } from '@/lib/types'

export default function ExplorerPage() {
  return <DataGate>{() => <Explorer />}</DataGate>
}

function Explorer() {
  const network = useNetworkMap()
  // The selected station lives in the URL (?station=ID) so it can be linked to and opened from the command palette.
  const [params, setParams] = useSearchParams()
  const selected = params.get('station')
  const setSelected = (id: string | null) => setParams(id ? { station: id } : {}, { replace: true })
  const [visible, setVisible] = useState<Set<string> | null>(null)
  const [nearMode, setNearMode] = useState(false)
  const [point, setPoint] = useState<{ lat: number; lon: number } | null>(null)
  const [radius, setRadius] = useState(1500)
  const [geoError, setGeoError] = useState<string | null>(null)

  const detail = useQuery({ queryKey: ['station', selected], queryFn: () => api.station(selected!), enabled: !!selected })
  const nearby = useQuery({
    queryKey: ['nearby', point?.lat, point?.lon, radius],
    queryFn: () => api.nearby(point!.lat, point!.lon, radius),
    enabled: !!point,
  })

  const visibleSet = useMemo(() => visible ?? new Set(network.data?.lines.map((l) => l.id) ?? []), [visible, network.data])
  const toggleLine = (id: string) => {
    const n = new Set(visibleSet)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    setVisible(n)
  }

  const locate = () => {
    setGeoError(null)
    if (!navigator.geolocation) return setGeoError('Geolocation is not available in this browser.')
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setNearMode(true)
        setPoint({ lat: p.coords.latitude, lon: p.coords.longitude })
      },
      (e) => setGeoError(e.message || 'Location permission denied.'),
      { enableHighAccuracy: false, timeout: 10_000 },
    )
  }

  const d = detail.data
  return (
    <div className="relative flex h-full flex-col lg:block">
      <section aria-label="Network map" className="relative h-[55vh] shrink-0 lg:absolute lg:inset-0 lg:h-full">
        {network.data ? (
          <TransitMap
            network={network.data}
            visibleLines={visibleSet}
            selectedStation={selected}
            onStationClick={(id) => {
              setSelected(id)
            }}
            onMapClick={nearMode ? (lat, lon) => setPoint({ lat, lon }) : undefined}
            circle={nearMode && point ? { ...point, radius } : null}
            fitKey={nearMode && point ? `${point.lat},${point.lon},${radius}` : selected && d?.lat != null ? `sel-${selected}` : 'network'}
            focus={d && d.lat != null && d.lon != null ? [d.lat, d.lon] : null}
          />
        ) : (
          <Skeleton className="h-full w-full rounded-none" />
        )}
        <div className="absolute left-3 right-14 top-3 z-[500] max-w-sm lg:left-4 lg:top-4 [&_div.flex]:glass">
          <StationCombobox
            label="Find a station"
            value={null}
            onChange={(s: StationSummary | null) => s && setSelected(s.id)}
            placeholder="Find a station…"
          />
        </div>
        {network.data && (
          <div className="absolute bottom-6 left-3 z-[500] lg:left-4">
            <MapLegend lines={network.data.lines} visible={visibleSet} onToggle={toggleLine} collapsible defaultOpen />
          </div>
        )}
      </section>

      <aside
        aria-label="Station details"
        className="space-y-3 overflow-y-auto p-4 lg:glass lg:absolute lg:bottom-4 lg:right-16 lg:top-4 lg:z-[600] lg:w-[380px] lg:rounded-2xl"
      >
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Nearby stations</CardTitle>
            <Button size="sm" variant={nearMode ? 'secondary' : 'outline'} onClick={() => { setNearMode((m) => !m); if (nearMode) setPoint(null) }}>
              <Crosshair /> {nearMode ? 'Done' : 'Pick on map'}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {nearMode ? (
              <>
                <p className="text-xs text-muted-foreground">Click anywhere on the map, or use your location.</p>
                <Button size="sm" variant="outline" onClick={locate}>
                  <LocateFixed /> Use my location
                </Button>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <Label>Radius</Label>
                    <span className="tabular text-muted-foreground">{fmtDistance(radius)}</span>
                  </div>
                  <Slider label="Search radius" min={200} max={10000} step={100} value={[radius]} onValueChange={([v]) => setRadius(v)} />
                </div>
                {geoError && <Callout tone="warning">{geoError}</Callout>}
                {point && nearby.data && (
                  nearby.data.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No station within {fmtDistance(radius)} of this point.</p>
                  ) : (
                    <ul className="divide-y rounded-md border">
                      {nearby.data.map((s) => (
                        <li key={s.id}>
                          <button type="button" onClick={() => setSelected(s.id)} className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted">
                            <span className="truncate">{s.name}</span>
                            <span className="flex items-center gap-2">
                              <LineDots lines={s.lines} />
                              <span className="tabular text-xs text-muted-foreground">{fmtDistance(s.distance_m)}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )
                )}
                <p className="text-[11px] text-muted-foreground">Straight-line distance from the chosen point, not walking distance.</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Find stations within a radius of any point using the dataset's station coordinates.</p>
            )}
          </CardContent>
        </Card>

        {!selected && (
          <Card>
            <EmptyState icon={<MapPin />} title="Select a station">
              Click a station on the map or search for one to see its lines, connections and scheduled service.
            </EmptyState>
          </Card>
        )}
        {selected && detail.isLoading && <Skeleton className="h-64" />}
        {d && (
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="text-base">{d.name}</CardTitle>
                <p className="tabular text-xs text-muted-foreground">
                  ID {d.id} · {d.lat?.toFixed(5)}, {d.lon?.toFixed(5)}
                </p>
              </div>
              <Button size="icon-sm" variant="ghost" aria-label="Close station details" onClick={() => setSelected(null)}>
                <X />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-1">
                {d.line_details.map((l) => (
                  <LineChip key={l.id} name={l.name} color={l.color} />
                ))}
                {d.interchange && <Badge tone="primary">interchange</Badge>}
                {!d.routable && <Badge tone="warning">not served</Badge>}
              </div>
              <div className="flex gap-2">
                <Link to={`/plan?from=${encodeURIComponent(d.id)}`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                  <Navigation /> Plan from here
                </Link>
              </div>

              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connected stations</h3>
                <ul className="divide-y rounded-md border">
                  {d.neighbors.map((n) => (
                    <li key={n.id}>
                      <button type="button" onClick={() => setSelected(n.id)} className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-muted">
                        <span className="min-w-0">
                          <span className="block truncate">{n.name}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {n.outbound && n.inbound ? 'both directions' : n.outbound ? 'outbound only' : 'inbound only'}
                          </span>
                        </span>
                        <span className="tabular shrink-0 text-right text-xs text-muted-foreground">
                          {fmtDuration(n.scheduled_time_s)}
                          <br />
                          {fmtDistance(n.distance_m)}
                          {n.distance_source === 'straight_line_estimate' && '*'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {d.neighbors.some((n) => n.distance_source === 'straight_line_estimate') && (
                  <p className="mt-1 text-[11px] text-muted-foreground">* straight-line estimate (no usable track distance in the feed)</p>
                )}
              </section>

              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scheduled departures (from timetable)</h3>
                {d.scheduled_departures.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No departures in the timetable.</p>
                ) : (
                  <table className="tabular w-full text-xs">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="py-1 font-medium">Route</th>
                        <th className="py-1 font-medium">Days</th>
                        <th className="py-1 text-right font-medium">Trips</th>
                        <th className="py-1 text-right font-medium">First–last</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.scheduled_departures.map((s) => (
                        <tr key={`${s.route_id}-${s.service_id}`} className="border-t">
                          <td className="max-w-[140px] truncate py-1" title={s.route_long_name}>
                            {s.route_long_name.replace(/^[^_]*_/, '')}
                          </td>
                          <td className="py-1">{s.service_id}</td>
                          <td className="py-1 text-right">{s.departures}</td>
                          <td className="py-1 text-right">
                            {s.first}–{s.last}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="space-y-1 text-xs text-muted-foreground">
                <h3 className="text-xs font-semibold uppercase tracking-wide">Data notes</h3>
                <p>Source stop IDs: {d.stop_ids.join(', ')}</p>
                <p>Transfer timing: {d.min_transfer_time_s != null ? fmtDuration(d.min_transfer_time_s) + ' (transfers.txt)' : 'not provided by the feed'}</p>
                <p>Accessibility: {d.accessibility_note ?? (d.wheelchair_boarding === 1 ? 'Wheelchair boarding possible (feed)' : 'Wheelchair boarding not possible (feed)')}</p>
              </section>
            </CardContent>
          </Card>
        )}
      </aside>
    </div>
  )
}
