import { MapPin, Search, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { api } from '@/lib/api'
import type { StationSummary } from '@/lib/types'
import { cn } from '@/lib/utils'
import { LineDots } from './LineChip'

interface Props {
  label: string
  value: StationSummary | null
  onChange: (s: StationSummary | null) => void
  placeholder?: string
  icon?: 'origin' | 'destination'
  autoFocus?: boolean
}

/** Accessible, server-searched station picker (ARIA combobox pattern). Only matching stations are
 *  fetched, so it stays responsive regardless of network size. */
export function StationCombobox({ label, value, onChange, placeholder, icon, autoFocus }: Props) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<StationSummary[]>([])
  const [total, setTotal] = useState(0)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!open) return
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const page = await api.stations(query, 12, 0, ctrl.signal)
        setItems(page.items)
        setTotal(page.total)
        setActive(0)
      } catch (e) {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : 'Search failed')
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    }, 150)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [query, open])

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (s: StationSummary) => {
    onChange(s)
    setQuery('')
    setOpen(false)
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && open && items[active]) {
      e.preventDefault()
      choose(items[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const dot =
    icon === 'origin' ? (
      <span className="size-2.5 rounded-full border-2 border-primary bg-card" aria-hidden />
    ) : icon === 'destination' ? (
      <MapPin className="size-3.5 text-danger" aria-hidden />
    ) : (
      <Search className="size-3.5 text-muted-foreground" aria-hidden />
    )

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div
        className={cn(
          'flex h-10 items-center gap-2 rounded-md border border-input bg-card px-3 focus-within:outline-2 focus-within:outline-ring',
        )}
      >
        <span className="flex w-4 justify-center">{dot}</span>
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && items[active] ? `${id}-opt-${active}` : undefined}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          placeholder={value ? value.name : placeholder ?? label}
          className={cn('h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground', value && !query && 'placeholder:text-foreground')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKey}
        />
        {value && (
          <button
            type="button"
            aria-label={`Clear ${label.toLowerCase()}`}
            className="cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => {
              onChange(null)
              setQuery('')
              inputRef.current?.focus()
            }}
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {open && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute z-[1100] mt-1 max-h-72 w-full overflow-auto rounded-md border bg-card py-1 shadow-pop"
        >
          {loading && items.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Searching…</li>}
          {error && <li className="px-3 py-2 text-sm text-danger">{error}</li>}
          {!loading && !error && items.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">No station matches “{query}”.</li>
          )}
          {items.map((s, i) => (
            <li
              key={s.id}
              id={`${id}-opt-${i}`}
              data-idx={i}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(s)
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm',
                i === active && 'bg-muted',
                !s.routable && 'opacity-50',
              )}
            >
              <span className="truncate">{s.name}</span>
              <LineDots lines={s.lines} />
            </li>
          ))}
          {total > items.length && (
            <li className="px-3 py-1.5 text-[11px] text-muted-foreground">
              {total - items.length} more — keep typing to narrow down
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
