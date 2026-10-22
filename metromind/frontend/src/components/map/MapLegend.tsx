import { Layers, X } from 'lucide-react'
import { useState } from 'react'
import { hex } from '@/lib/format'
import type { LineInfo } from '@/lib/types'
import { cn } from '@/lib/utils'

const SOURCE_NOTE: Record<string, string> = {
  feed: 'colour from the feed',
  inferred_from_name: 'colour inferred from the line name (the feed has no route_color)',
  fallback_palette: 'placeholder colour (the feed has no route_color)',
}

export function MapLegend({
  lines,
  visible,
  onToggle,
  collapsible,
  defaultOpen,
  className,
}: {
  lines: LineInfo[]
  visible?: Set<string>
  onToggle?: (id: string) => void
  collapsible?: boolean
  defaultOpen?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen ?? !collapsible)
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex cursor-pointer items-center gap-1.5 rounded-md border bg-card/95 px-2.5 py-1.5 text-xs font-medium shadow-pop backdrop-blur hover:bg-muted"
        aria-expanded={false}
      >
        <Layers className="size-3.5" /> Lines
      </button>
    )
  return (
    <div className={cn('w-64 rounded-md border bg-card/95 p-2 text-xs shadow-pop backdrop-blur', className)}>
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Lines{onToggle && ' · click to toggle'}
        </span>
        {collapsible && (
          <button type="button" aria-label="Hide legend" onClick={() => setOpen(false)} className="cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <ul className="grid grid-cols-2 gap-x-2 gap-y-0.5">
        {lines.map((l) => {
          const on = !visible || visible.has(l.id)
          return (
            <li key={l.id}>
              <button
                type="button"
                disabled={!onToggle}
                aria-pressed={onToggle ? on : undefined}
                onClick={() => onToggle?.(l.id)}
                title={SOURCE_NOTE[l.color_source]}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left enabled:cursor-pointer enabled:hover:bg-muted',
                  !on && 'opacity-40',
                )}
              >
                <span className="h-1.5 w-4 shrink-0 rounded-full" style={{ background: hex(l.color) }} />
                <span className="truncate">{l.name}</span>
                {l.color_source !== 'feed' && <span className="text-muted-foreground">*</span>}
              </button>
            </li>
          )
        })}
      </ul>
      {lines.some((l) => l.color_source !== 'feed') && (
        <p className="mt-1 px-1 text-[10px] text-muted-foreground">* display colour not provided by the feed</p>
      )}
    </div>
  )
}
