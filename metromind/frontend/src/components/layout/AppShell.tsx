import { ChevronsLeft, ChevronsRight, Menu, Monitor, Moon, Search, Sun, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useId, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { EngineBanner } from '@/components/EngineBanner'
import { Badge, Kbd, Tip } from '@/components/ui'
import { emit, modKey } from '@/lib/commands'
import { usePrefs, type Theme } from '@/lib/prefs'
import { useMeta } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { NAV_GROUPS } from './nav'

const COLLAPSE_KEY = 'metromind.sidebarCollapsed'

export function LogoMark({ className }: { className?: string }) {
  // Unique per instance: a gradient defined inside a hidden (display:none) copy would not render elsewhere.
  const gid = `mm-logo-${useId().replace(/:/g, '')}`
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7 shrink-0', className)} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(221 83% 56%)" />
          <stop offset="1" stopColor="hsl(262 83% 58%)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gid})`} />
      <path d="M8 22V10l8 8 8-8v12" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="18" r="2.2" fill="white" />
    </svg>
  )
}

export function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 rounded-lg font-semibold tracking-tight" aria-label="MetroMind home">
      <LogoMark />
      {!collapsed && <span className="text-[15px]">MetroMind</span>}
    </Link>
  )
}

function ThemeSwitch({ compact }: { compact?: boolean }) {
  const { prefs, setPrefs } = usePrefs()
  const opts: { v: Theme; icon: typeof Sun; label: string }[] = [
    { v: 'light', icon: Sun, label: 'Light theme' },
    { v: 'system', icon: Monitor, label: 'System theme' },
    { v: 'dark', icon: Moon, label: 'Dark theme' },
  ]
  if (compact) {
    const next = prefs.theme === 'light' ? 'dark' : prefs.theme === 'dark' ? 'system' : 'light'
    const cur = opts.find((o) => o.v === prefs.theme)!
    return (
      <Tip content={`${cur.label} — click for ${next}`} side="right">
        <button
          type="button"
          aria-label={`Theme: ${cur.label}. Switch to ${next}.`}
          onClick={() => setPrefs({ theme: next })}
          className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <cur.icon className="size-4" />
        </button>
      </Tip>
    )
  }
  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded-lg bg-muted p-0.5">
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
            'relative flex flex-1 cursor-pointer items-center justify-center rounded-md py-1.5 text-muted-foreground transition-colors hover:text-foreground',
            prefs.theme === v && 'text-foreground',
          )}
        >
          {prefs.theme === v && (
            <motion.span layoutId="theme-pill" className="absolute inset-0 rounded-md bg-card shadow-card" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
          )}
          <Icon className="relative size-3.5" />
        </button>
      ))}
    </div>
  )
}

function DatasetStatus({ collapsed }: { collapsed?: boolean }) {
  const meta = useMeta()
  if (meta.isLoading) return collapsed ? null : <div className="skeleton-shimmer h-16 rounded-xl" />
  if (meta.error || !meta.data)
    return (
      <Link to="/data" className="block rounded-xl border border-danger/25 bg-danger-soft p-2.5 text-xs" title="No active dataset">
        {collapsed ? <span className="block size-2 rounded-full bg-danger" /> : (
          <>
            <div className="font-medium text-danger">No active dataset</div>
            <div className="text-muted-foreground">Import a GTFS feed to begin.</div>
          </>
        )}
      </Link>
    )
  const d = meta.data
  const dot = d.freshness.status === 'current' ? 'bg-success' : 'bg-warning'
  if (collapsed)
    return (
      <Tip content={`${d.dataset.label} · ${d.freshness.status}`} side="right">
        <Link to="/data" className="mx-auto flex size-9 items-center justify-center rounded-lg hover:bg-muted" aria-label="Dataset status">
          <span className={cn('size-2 rounded-full', dot)} />
        </Link>
      </Tip>
    )
  return (
    <Link to="/data" className="group block rounded-xl border bg-card p-2.5 text-xs shadow-card transition-colors hover:border-muted-foreground/30" title={d.freshness.message}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium">
          <span className={cn('size-1.5 rounded-full', dot)} /> Dataset #{d.dataset.id}
        </span>
        <Badge tone={d.freshness.status === 'current' ? 'success' : 'warning'}>
          {d.freshness.status === 'expired' ? 'calendar ended' : d.freshness.status}
        </Badge>
      </div>
      <div className="mt-1 truncate text-muted-foreground">{d.dataset.label}</div>
      <div className="tabular text-muted-foreground">
        {d.counts.stations} stations · {d.counts.lines} lines
      </div>
    </Link>
  )
}

function SearchButton({ collapsed }: { collapsed?: boolean }) {
  if (collapsed)
    return (
      <Tip content={`Search (${modKey} K)`} side="right">
        <button
          type="button"
          onClick={() => emit('palette:open')}
          aria-label="Open search"
          className="mx-auto flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Search className="size-4" />
        </button>
      </Tip>
    )
  return (
    <button
      type="button"
      onClick={() => emit('palette:open')}
      className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg border bg-card px-2.5 text-sm text-muted-foreground shadow-card transition-colors hover:border-muted-foreground/30 hover:text-foreground"
    >
      <Search className="size-4" aria-hidden />
      <span className="flex-1 text-left">Search…</span>
      <Kbd>{modKey}</Kbd>
      <Kbd>K</Kbd>
    </button>
  )
}

function NavList({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation()
  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {NAV_GROUPS.map((g) => (
        <div key={g.label} className="flex flex-col gap-0.5">
          {!collapsed && <div className="px-2.5 pb-1 text-[11px] font-medium text-muted-foreground/80">{g.label}</div>}
          {g.items.map(({ to, label, icon: Icon, key }) => {
            const active = pathname === to
            const link = (
              <NavLink
                key={to}
                to={to}
                onClick={onNavigate}
                aria-label={collapsed ? label : undefined}
                className={cn(
                  'relative flex items-center gap-2.5 rounded-lg py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
                  collapsed ? 'justify-center px-0' : 'px-2.5',
                  !active && 'hover:bg-muted/70',
                  active && 'text-foreground',
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-lg bg-card shadow-card ring-1 ring-border"
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  />
                )}
                <Icon className={cn('relative size-4 shrink-0', active && 'text-primary')} aria-hidden />
                {!collapsed && (
                  <>
                    <span className="relative flex-1">{label}</span>
                    <span className="relative hidden gap-0.5 opacity-0 transition-opacity group-hover/nav:flex group-hover/nav:opacity-100">
                      <Kbd>g</Kbd>
                      <Kbd>{key}</Kbd>
                    </span>
                  </>
                )}
              </NavLink>
            )
            return collapsed ? (
              <Tip key={to} content={label} side="right">
                {link}
              </Tip>
            ) : (
              link
            )
          })}
        </div>
      ))}
    </nav>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  const { pathname } = useLocation()
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      } catch {
        /* ignore */
      }
      return !c
    })

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[2100] focus:rounded focus:bg-card focus:p-2">
        Skip to content
      </a>
      <aside
        className={cn(
          'group/nav hidden shrink-0 flex-col gap-4 border-r bg-muted/30 py-3 transition-[width] duration-300 ease-[var(--ease-out-quint)] lg:flex',
          collapsed ? 'w-[64px] px-2' : 'w-[240px] px-3',
        )}
      >
        <div className={cn('flex items-center pt-0.5', collapsed ? 'justify-center' : 'justify-between px-1')}>
          <Logo collapsed={collapsed} />
        </div>
        <SearchButton collapsed={collapsed} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NavList collapsed={collapsed} />
        </div>
        <div className="space-y-2">
          <DatasetStatus collapsed={collapsed} />
          <div className={cn('flex items-center gap-1', collapsed && 'flex-col')}>
            <div className={collapsed ? '' : 'flex-1'}>
              <ThemeSwitch compact={collapsed} />
            </div>
            <Tip content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right">
              <button
                type="button"
                onClick={toggle}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
              </button>
            </Tip>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-card/80 px-3 backdrop-blur lg:hidden">
          <Logo />
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => emit('palette:open')} aria-label="Search" className="cursor-pointer rounded-lg p-2.5 hover:bg-muted">
              <Search className="size-5" />
            </button>
            <button
              type="button"
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              className="cursor-pointer rounded-lg p-2.5 hover:bg-muted"
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </header>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 top-14 z-[1500] flex flex-col gap-5 overflow-auto bg-background p-4 lg:hidden"
            >
              <NavList onNavigate={() => setOpen(false)} />
              <DatasetStatus />
              <ThemeSwitch />
            </motion.div>
          )}
        </AnimatePresence>
        <EngineBanner />
        <main id="main" className="relative min-h-0 flex-1 overflow-auto">
          <div key={pathname} className="h-full animate-fade-up">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
