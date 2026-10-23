// Tiny global event bus for app-wide UI commands (command palette, shortcut help).
type Cmd = 'palette:open' | 'shortcuts:open'
const target = new EventTarget()

export function emit(cmd: Cmd) {
  target.dispatchEvent(new Event(cmd))
}

export function on(cmd: Cmd, fn: () => void): () => void {
  target.addEventListener(cmd, fn)
  return () => target.removeEventListener(cmd, fn)
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const modKey = isMac ? '⌘' : 'Ctrl'
