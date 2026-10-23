import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Kbd } from '@/components/ui'
import { emit, modKey, on } from '@/lib/commands'
import { usePrefs } from '@/lib/prefs'
import { NAV_ITEMS } from './layout/nav'

function typing(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null
  return !!el?.closest('input, textarea, select, [contenteditable=true], [role=combobox]')
}

/** Global keyboard shortcuts plus the "?" help sheet. */
export function Shortcuts() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { isDark, setPrefs } = usePrefs()

  useEffect(() => on('shortcuts:open', () => setOpen(true)), [])

  useEffect(() => {
    let pendingG = 0
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        emit('palette:open')
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e)) return
      if (e.key === '/') {
        e.preventDefault()
        emit('palette:open')
      } else if (e.key === '?') {
        setOpen(true)
      } else if (e.key === 't') {
        setPrefs({ theme: isDark ? 'light' : 'dark' })
      } else if (e.key === 'g') {
        pendingG = Date.now()
      } else if (Date.now() - pendingG < 900) {
        const item = NAV_ITEMS.find((n) => n.key === e.key)
        if (item) navigate(item.to)
        pendingG = 0
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, isDark, setPrefs])

  const rows: [string[], string][] = [
    [[modKey, 'K'], 'Open command palette'],
    [['/'], 'Search stations and pages'],
    ...NAV_ITEMS.map((n): [string[], string] => [['g', n.key], `Go to ${n.label}`]),
    [['t'], 'Toggle light / dark theme'],
    [['Space'], 'Play / pause (Algorithm lab)'],
    [['←', '→'], 'Step through a trace (Algorithm lab)'],
    [['?'], 'Show this help'],
  ]

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[1900] animate-fade-up bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[2000] w-[min(460px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 animate-fade-up rounded-2xl border bg-elevated p-5 shadow-float">
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">Keyboard shortcuts</Dialog.Title>
            <Dialog.Close className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">Keys that work anywhere in MetroMind</Dialog.Description>
          <ul className="divide-y">
            {rows.map(([keys, label]) => (
              <li key={label} className="flex items-center justify-between py-2 text-sm">
                <span>{label}</span>
                <span className="flex gap-1">
                  {keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
