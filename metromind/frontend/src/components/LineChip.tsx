import { hex, onColor } from '@/lib/format'
import { useLines } from '@/lib/queries'
import { cn } from '@/lib/utils'

export function LineChip({ lineId, name, color, className }: { lineId?: string; name?: string; color?: string; className?: string }) {
  const { lines } = useLines()
  const line = lineId ? lines.get(lineId) : undefined
  const c = color ?? line?.color ?? '64748b'
  const label = name ?? line?.name ?? lineId ?? '?'
  return (
    <span
      className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold leading-4', className)}
      style={{ background: hex(c), color: onColor(c) }}
    >
      {label}
    </span>
  )
}

export function LineDots({ lines: ids }: { lines: string[] }) {
  const { lines } = useLines()
  return (
    <span className="flex shrink-0 items-center gap-1" aria-label={`Lines: ${ids.map((i) => lines.get(i)?.name ?? i).join(', ')}`}>
      {ids.map((id) => (
        <span
          key={id}
          title={lines.get(id)?.name ?? id}
          className="size-2.5 rounded-full ring-1 ring-black/10"
          style={{ background: hex(lines.get(id)?.color ?? '94a3b8') }}
        />
      ))}
    </span>
  )
}
