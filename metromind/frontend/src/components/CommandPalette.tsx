import { Command } from 'cmdk'
import { ArrowRight, CornerDownLeft, Keyboard, MapPin, Monitor, Moon, Navigation, Search, Sun } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Kbd } from '@/components/ui'
import { api } from '@/lib/api'
import { emit, modKey, on } from '@/lib/commands'
import { usePrefs } from '@/lib/prefs'
import type { StationSummary } from '@/lib/types'
import { LineDots } from './LineChip'
import { NAV_ITEMS } from './layout/nav'

/** ⌘K / Ctrl+K: jump to pages, find stations, start a route, switch theme. */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [stations, setStations] = useState<StationSummary[]>([])
  const navigate = useNavigate()
  const { setPrefs } = usePrefs()

  useEffect(() => on('palette:open', () => setOpen(true)), [])

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setStations([])
      return
    }
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      api
        .stations(query, 6, 0, ctrl.signal)
        .then((p) => setStations(p.items))
        .catch(() => setStations([]))
    }, 120)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [query, open])

  const q = query.trim().toLowerCase()
  const pages = useMemo(
    () => NAV_ITEMS.filter((n) => !q || n.label.toLowerCase().includes(q) || n.description.toLowerCase().includes(q)),
    [q],
  )
  const themes = [
    { id: 'light', label: 'Light theme', icon: Sun },
    { id: 'dark', label: 'Dark theme', icon: Moon },
    { id: 'system', label: 'System theme', icon: Monitor },
  ].filter((t) => !q || t.label.toLowerCase().includes(q) || 'theme'.includes(q))

  const go = (fn: () => void) => {
    setOpen(false)
    setQuery('')
    fn()
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQuery('')
      }}
      label="Command palette"
      shouldFilter={false}
      overlayClassName="fixed inset-0 z-[1900] bg-black/40 backdrop-blur-[2px] animate-fade-up"
      contentClassName="fixed left-1/2 top-[14vh] z-[2000] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-2xl border bg-elevated shadow-float animate-fade-up"
    >
      <div className="flex items-center gap-2.5 border-b px-4">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search stations, pages and actions…"
          className="h-13 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
        <Kbd>esc</Kbd>
      </div>
      <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
        <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
          {q.length < 2 ? 'Type to search' : `No results for “${query}”`}
        </Command.Empty>

        {stations.length > 0 && (
          <Command.Group heading="Stations">
            {stations.map((s) => (
              <Command.Item
                key={`st-${s.id}`}
                value={`st-${s.id}`}
                onSelect={() => go(() => navigate(`/explore?station=${encodeURIComponent(s.id)}`))}
                className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm"
              >
                <MapPin className="size-4 text-muted-foreground" aria-hidden />
                <span className="flex-1 truncate">{s.name}</span>
                <LineDots lines={s.lines} />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    go(() => navigate(`/plan?from=${encodeURIComponent(s.id)}`))
                  }}
                  className="hidden cursor-pointer items-center gap-1 rounded-md border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground group-data-[selected=true]:inline-flex"
                >
                  <Navigation className="size-3" /> Route from here
                </button>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {pages.length > 0 && (
          <Command.Group heading="Go to">
            {pages.map((n) => (
              <Command.Item
                key={n.to}
                value={n.to}
                onSelect={() => go(() => navigate(n.to))}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm"
              >
                <n.icon className="size-4 text-muted-foreground" aria-hidden />
                <span className="flex-1">
                  {n.label}
                  <span className="ml-2 text-xs text-muted-foreground">{n.description}</span>
                </span>
                <span className="flex gap-1">
                  <Kbd>g</Kbd>
                  <Kbd>{n.key}</Kbd>
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {themes.length > 0 && (
          <Command.Group heading="Appearance">
            {themes.map((t) => (
              <Command.Item
                key={t.id}
                value={`theme-${t.id}`}
                onSelect={() => go(() => setPrefs({ theme: t.id as 'light' | 'dark' | 'system' }))}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm"
              >
                <t.icon className="size-4 text-muted-foreground" aria-hidden />
                {t.label}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {(!q || 'keyboard shortcuts help'.includes(q)) && (
          <Command.Group heading="Help">
            <Command.Item
              value="shortcuts"
              onSelect={() => go(() => emit('shortcuts:open'))}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm"
            >
              <Keyboard className="size-4 text-muted-foreground" aria-hidden />
              <span className="flex-1">Keyboard shortcuts</span>
              <Kbd>?</Kbd>
            </Command.Item>
          </Command.Group>
        )}
      </Command.List>
      <div className="flex items-center justify-between border-t bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> navigate <Kbd className="ml-1.5">
            <CornerDownLeft className="size-3" />
          </Kbd>{' '}
          open
        </span>
        <span className="flex items-center gap-1">
          <ArrowRight className="size-3" /> {modKey} K anywhere
        </span>
      </div>
    </Command.Dialog>
  )
}
