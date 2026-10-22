import {
  BarChart3,
  Database,
  FlaskConical,
  GitCompareArrows,
  Map as MapIcon,
  Menu,
  Monitor,
  Moon,
  Navigation,
  Settings as SettingsIcon,
  Sun,
  X,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { EngineBanner } from '@/components/EngineBanner'
import { Badge } from '@/components/ui'
import { usePrefs, type Theme } from '@/lib/prefs'
import { useMeta } from '@/lib/queries'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/plan', label: 'Route planner', icon: Navigation },
  { to: '/lab', label: 'Algorithm lab', icon: FlaskConical },
  { to: '/compare', label: 'Compare', icon: GitCompareArrows },
  { to: '/explore', label: 'Network explorer', icon: MapIcon },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/data', label: 'Dataset', icon: Database },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn('flex items-center gap-2 font-semibold tracking-tight', className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="8" className="fill-primary" />
        <path d="M8 22V10l8 8 8-8v12" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="16" cy="18" r="2.2" fill="white" />
      </svg>
      <span>MetroMind</span>
    </Link>
  )
}

function ThemeSwitch() {
  const { prefs, setPrefs } = usePrefs()
  const opts: { v: Theme; icon: typeof Sun; label: string }[] = [
    { v: 'light', icon: Sun, label: 'Light theme' },
    { v: 'system', icon: Monitor, label: 'System theme' },
    { v: 'dark', icon: Moon, label: 'Dark theme' },
  ]
  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded-md bg-muted p-0.5">
      {opts.map(({ v, icon: Icon, label }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={prefs.theme === v}
          aria-label={label}
          title={label}
          onClick={() => setPrefs({ theme: v })}
          className={cn(
            'flex flex-1 cursor-pointer items-center justify-center rounded-sm py-1 text-muted-foreground hover:text-foreground',
            prefs.theme === v && 'bg-card text-foreground shadow-card',
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  )
}

function DatasetStatus() {
  const meta = useMeta()
  if (meta.isLoading) return <div className="text-xs text-muted-foreground">Loading dataset…</div>
  if (meta.error || !meta.data)
    return (
      <Link to="/data" className="block rounded-md bg-danger-soft p-2 text-xs">
        <div className="font-medium text-danger">No active dataset</div>
        <div className="text-muted-foreground">Import a GTFS feed to begin.</div>
      </Link>
    )
  const d = meta.data
  const tone = { current: 'success', expiring: 'warning', expired: 'warning', future: 'neutral', unknown: 'neutral' } as const
  return (
    <Link to="/data" className="block rounded-md border bg-card p-2 text-xs hover:bg-muted" title={d.freshness.message}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">Dataset #{d.dataset.id}</span>
        <Badge tone={tone[d.freshness.status]}>
          {d.freshness.status === 'expired' ? 'calendar expired' : d.freshness.status}
        </Badge>
      </div>
      <div className="mt-0.5 truncate text-muted-foreground">{d.dataset.label}</div>
      <div className="tabular text-muted-foreground">
        {d.counts.stations} stations · {d.counts.lines} lines
      </div>
    </Link>
  )
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              isActive && 'bg-accent text-accent-foreground hover:bg-accent',
            )
          }
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex h-dvh overflow-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[2000] focus:rounded focus:bg-card focus:p-2">
        Skip to content
      </a>
      <aside className="hidden w-60 shrink-0 flex-col gap-4 border-r bg-card/60 p-3 lg:flex">
        <Logo className="px-1 pt-1" />
        <NavList />
        <div className="mt-auto space-y-2">
          <DatasetStatus />
          <ThemeSwitch />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card/80 px-4 backdrop-blur lg:hidden">
          <Logo />
          <button
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className="cursor-pointer rounded-md p-2 hover:bg-muted"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </header>
        {open && (
          <div className="fixed inset-0 top-14 z-[1500] flex flex-col gap-4 overflow-auto bg-background p-4 lg:hidden">
            <NavList onNavigate={() => setOpen(false)} />
            <DatasetStatus />
            <ThemeSwitch />
          </div>
        )}
        <EngineBanner />
        <main id="main" className="min-h-0 flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
