import L, { type LatLngBoundsExpression, type LatLngExpression } from 'leaflet'
import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Circle, CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { hex } from '@/lib/format'
import type { JourneyStation, NetworkMap, Ride } from '@/lib/types'
import { usePrefs } from '@/lib/prefs'
import { cn } from '@/lib/utils'

const TILE_URL = (import.meta.env.VITE_TILE_URL as string | undefined) ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION =
  (import.meta.env.VITE_TILE_ATTRIBUTION as string | undefined) ??
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export interface ExploreOverlay {
  expanded: Set<string>
  discovered: Set<string>
  frontier: Set<string>
  current?: string | null
  /** order index of expansion, for a heat gradient */
  order?: Map<string, number>
}

export interface RouteOverlay {
  key: string
  rides: Ride[]
  stations: JourneyStation[]
  dashed?: boolean
  muted?: boolean
  color?: string
}

interface Props {
  network?: NetworkMap
  routes?: RouteOverlay[]
  explore?: ExploreOverlay
  visibleLines?: Set<string>
  selectedStation?: string | null
  onStationClick?: (id: string) => void
  onMapClick?: (lat: number, lon: number) => void
  circle?: { lat: number; lon: number; radius: number } | null
  fitKey?: string
  className?: string
  children?: ReactNode
  showAllStations?: boolean
  /** Point to centre on (e.g. a selected station) when no route is shown. */
  focus?: [number, number] | null
}

/** Fits the view whenever `fitKey` changes, and re-fits after container resizes until the user pans or zooms. */
function FitController({ bounds, fitKey }: { bounds: LatLngBoundsExpression | null; fitKey?: string }) {
  const map = useMap()
  const userMoved = useRef(false)
  const latest = useRef(bounds)
  latest.current = bounds

  useEffect(() => {
    userMoved.current = false
    if (bounds) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map])

  useEffect(() => {
    const el = map.getContainer()
    const mark = () => (userMoved.current = true)
    el.addEventListener('wheel', mark, { passive: true })
    el.addEventListener('pointerdown', mark)
    const ro = new ResizeObserver(() => {
      map.invalidateSize()
      if (!userMoved.current && latest.current) map.fitBounds(latest.current, { padding: [36, 36], maxZoom: 15, animate: false })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      el.removeEventListener('wheel', mark)
      el.removeEventListener('pointerdown', mark)
    }
  }, [map])
  return null
}

function ClickHandler({ onClick }: { onClick?: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onClick?.(e.latlng.lat, e.latlng.lng) })
  return null
}

export function TransitMap({
  network,
  routes = [],
  explore,
  visibleLines,
  selectedStation,
  onStationClick,
  onMapClick,
  circle,
  fitKey,
  className,
  children,
  showAllStations = true,
  focus,
}: Props) {
  const { isDark } = usePrefs()
  const hasOverlay = routes.some((r) => !r.muted) || !!explore
  const stationIndex = useMemo(() => new Map((network?.stations ?? []).map((s) => [s.id, s])), [network])

  const bounds = useMemo<LatLngBoundsExpression | null>(() => {
    const pts: [number, number][] = []
    for (const r of routes.filter((x) => !x.muted)) for (const s of r.stations) if (s.lat != null && s.lon != null) pts.push([s.lat, s.lon])
    if (pts.length >= 2) return L.latLngBounds(pts)
    if (pts.length === 1) return L.latLng(pts[0]).toBounds(1500)
    if (focus) return L.latLng(focus[0], focus[1]).toBounds(5000)
    if (circle) return L.latLng(circle.lat, circle.lon).toBounds(circle.radius * 2.2)
    if (network?.bounds) return network.bounds as LatLngBoundsExpression
    return null
  }, [routes, network, circle, focus])

  const center: LatLngExpression = network?.bounds
    ? [(network.bounds[0][0] + network.bounds[1][0]) / 2, (network.bounds[0][1] + network.bounds[1][1]) / 2]
    : [20, 0]

  const heat = (id: string) => {
    if (!explore?.order) return undefined
    const i = explore.order.get(id)
    if (i == null) return undefined
    const t = Math.min(1, i / Math.max(1, explore.order.size - 1))
    return `hsl(${200 - t * 160} 85% ${isDark ? 60 : 45}%)`
  }

  return (
    <div className={cn('relative h-full w-full overflow-hidden', className)}>
      <MapContainer center={center} zoom={11} zoomSnap={0.25} zoomDelta={0.5} preferCanvas className="h-full w-full" zoomControl attributionControl>
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={19} />
        <FitController bounds={bounds} fitKey={fitKey ?? JSON.stringify(bounds)} />
        <ClickHandler onClick={onMapClick} />

        {network?.routes
          .filter((r) => !visibleLines || visibleLines.has(r.line_id))
          .map((r) => (
            <Polyline
              key={r.route_id}
              positions={r.geometry}
              pathOptions={{ color: hex(r.color), weight: hasOverlay ? 2.5 : 3.5, opacity: hasOverlay ? 0.22 : 0.85 }}
              interactive={false}
            />
          ))}

        {circle && (
          <Circle
            center={[circle.lat, circle.lon]}
            radius={circle.radius}
            pathOptions={{ color: 'hsl(173 80% 30%)', weight: 1.5, fillOpacity: 0.08, dashArray: '4 4' }}
          />
        )}

        {routes.map((r) =>
          r.rides.map((ride, i) => (
            <Fragment key={`${r.key}-${i}`}>
              {!r.muted && <Polyline positions={ride.geometry} pathOptions={{ color: isDark ? '#0b1220' : '#ffffff', weight: 9, opacity: 0.9 }} />}
              <Polyline
                positions={ride.geometry}
                pathOptions={{
                  color: r.color ? hex(r.color) : hex(ride.color),
                  weight: r.muted ? 3 : 6,
                  opacity: r.muted ? 0.55 : 1,
                  dashArray: r.dashed ? '6 8' : undefined,
                  lineCap: 'round',
                }}
              >
                <Tooltip sticky className="mm-tooltip">
                  {ride.line_name} · {ride.route_long_name}
                </Tooltip>
              </Polyline>
            </Fragment>
          )),
        )}

        {network &&
          showAllStations &&
          network.stations
            .filter((s) => s.lat != null && s.lon != null && (!visibleLines || s.lines.some((l) => visibleLines.has(l))))
            .map((s) => {
              const isExpanded = explore?.expanded.has(s.id)
              const isFrontier = explore?.frontier.has(s.id)
              const isDiscovered = explore?.discovered.has(s.id)
              const isCurrent = explore?.current === s.id
              const selected = selectedStation === s.id
              const lineColor = hex(network.lines.find((l) => l.id === s.lines[0])?.color ?? '64748b')
              let fill = s.interchange ? (isDark ? '#e2e8f0' : '#ffffff') : isDark ? '#0f172a' : '#ffffff'
              let stroke = s.interchange ? (isDark ? '#f8fafc' : '#1e293b') : lineColor
              let radius = s.interchange ? 4.5 : 2.5
              let opacity = hasOverlay && !explore ? 0.45 : 1
              if (explore) {
                opacity = 1
                if (isExpanded) {
                  fill = heat(s.id) ?? '#0ea5e9'
                  stroke = fill
                  radius = 5
                } else if (isFrontier) {
                  fill = '#f59e0b'
                  stroke = '#b45309'
                  radius = 5
                } else if (isDiscovered) {
                  fill = '#fde68a'
                  stroke = '#d97706'
                  radius = 4
                } else {
                  opacity = 0.35
                }
                if (isCurrent) {
                  fill = '#ef4444'
                  stroke = '#7f1d1d'
                  radius = 8
                }
              }
              if (selected) {
                stroke = 'hsl(173 80% 30%)'
                radius = 8
              }
              return (
                <CircleMarker
                  key={s.id}
                  center={[s.lat!, s.lon!]}
                  radius={radius}
                  pathOptions={{ color: stroke, fillColor: fill, fillOpacity: opacity, opacity, weight: selected ? 3 : 1.5 }}
                  eventHandlers={onStationClick ? { click: () => onStationClick(s.id) } : undefined}
                  bubblingMouseEvents={false}
                >
                  <Tooltip className="mm-tooltip" direction="top" offset={[0, -4]}>
                    {s.name}
                  </Tooltip>
                </CircleMarker>
              )
            })}

        {routes
          .filter((r) => !r.muted)
          .flatMap((r) =>
            r.stations
              .filter((s) => s.role !== 'pass' && s.lat != null && s.lon != null)
              .map((s) => {
                const style =
                  s.role === 'origin'
                    ? { fill: 'hsl(173 80% 30%)', stroke: '#ffffff', r: 8 }
                    : s.role === 'destination'
                      ? { fill: '#dc2626', stroke: '#ffffff', r: 8 }
                      : { fill: '#ffffff', stroke: '#111827', r: 6.5 }
                return (
                  <CircleMarker
                    key={`${r.key}-${s.id}-${s.role}`}
                    center={[s.lat!, s.lon!]}
                    radius={style.r}
                    pathOptions={{ color: style.stroke, fillColor: style.fill, fillOpacity: 1, weight: 3 }}
                    eventHandlers={onStationClick ? { click: () => onStationClick(s.id) } : undefined}
                    bubblingMouseEvents={false}
                  >
                    <Tooltip className="mm-tooltip" direction="top" offset={[0, -6]} permanent={s.role !== 'transfer'}>
                      {s.role === 'transfer' ? `Change at ${s.name}` : (stationIndex.get(s.id)?.name ?? s.name)}
                    </Tooltip>
                  </CircleMarker>
                )
              }),
          )}
        {children}
      </MapContainer>
    </div>
  )
}
