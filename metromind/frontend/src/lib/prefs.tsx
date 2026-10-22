import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AlgorithmChoice, Objective } from './types'

export type Theme = 'system' | 'light' | 'dark'

export interface Prefs {
  theme: Theme
  objective: Objective
  algorithm: AlgorithmChoice
  /** null = use the server's default (reported in /api/meta). */
  transferPenaltyS: number | null
  minTransferS: number | null
  alternatives: number
  wTransferMin: number
  wStopMin: number
  traceSpeed: number // events per second in the algorithm lab
  recordHistory: boolean
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  objective: 'time',
  algorithm: 'auto',
  transferPenaltyS: null,
  minTransferS: null,
  alternatives: 2,
  wTransferMin: 5,
  wStopMin: 0.5,
  traceSpeed: 12,
  recordHistory: true,
}

const KEY = 'metromind.prefs'

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { ...DEFAULT_PREFS, ...(typeof raw === 'object' && raw ? raw : {}) }
  } catch {
    return DEFAULT_PREFS
  }
}

interface Ctx {
  prefs: Prefs
  setPrefs: (patch: Partial<Prefs>) => void
  reset: () => void
  isDark: boolean
}

const PrefsContext = createContext<Ctx | null>(null)

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, set] = useState<Prefs>(load)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const fn = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])

  const isDark = prefs.theme === 'dark' || (prefs.theme === 'system' && systemDark)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    set((p) => {
      const next = { ...p, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* storage unavailable: keep in memory */
      }
      return next
    })
  }, [])
  const reset = useCallback(() => setPrefs(DEFAULT_PREFS), [setPrefs])
  const value = useMemo(() => ({ prefs, setPrefs, reset, isDark }), [prefs, setPrefs, reset, isDark])
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePrefs(): Ctx {
  const ctx = useContext(PrefsContext)
  if (!ctx) throw new Error('usePrefs must be used inside PrefsProvider')
  return ctx
}
