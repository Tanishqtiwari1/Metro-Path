import type { AlgorithmChoice, Objective, PlanRequest } from './types'

// Shareable planner URLs: /plan?from=21&to=81&obj=time&algo=auto&mt=2&tp=300&alt=2&date=2025-12-25&time=08:30
const ID_RE = /^[\w\-.:@ ]{1,100}$/
const OBJECTIVES: Objective[] = ['time', 'transfers', 'distance', 'stops', 'balanced']
const ALGORITHMS: AlgorithmChoice[] = ['auto', 'gbfs', 'bfs', 'dijkstra', 'astar', 'csa']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/

export interface ShareState {
  origin?: string
  destination?: string
  objective?: Objective
  algorithm?: AlgorithmChoice
  maxTransfers?: number | null
  transferPenaltyS?: number | null
  alternatives?: number
  wTransferMin?: number
  wStopMin?: number
  date?: string | null
  time?: string | null
}

function intIn(v: string | null, lo: number, hi: number): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isInteger(n) && n >= lo && n <= hi ? n : undefined
}

function numIn(v: string | null, lo: number, hi: number): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined
}

/** Parse and validate URL parameters; invalid values are dropped, never trusted. */
export function parseShare(params: URLSearchParams): { state: ShareState; rejected: string[] } {
  const state: ShareState = {}
  const rejected: string[] = []
  const take = <T,>(key: string, ok: (v: string) => T | undefined, assign: (v: T) => void) => {
    const raw = params.get(key)
    if (raw == null) return
    const v = ok(raw)
    if (v === undefined) rejected.push(key)
    else assign(v)
  }
  take('from', (v) => (ID_RE.test(v) ? v : undefined), (v) => (state.origin = v))
  take('to', (v) => (ID_RE.test(v) ? v : undefined), (v) => (state.destination = v))
  take('obj', (v) => (OBJECTIVES.includes(v as Objective) ? (v as Objective) : undefined), (v) => (state.objective = v))
  take('algo', (v) => (ALGORITHMS.includes(v as AlgorithmChoice) ? (v as AlgorithmChoice) : undefined), (v) => (state.algorithm = v))
  take('mt', (v) => intIn(v, 0, 10), (v) => (state.maxTransfers = v))
  take('tp', (v) => intIn(v, 0, 3600), (v) => (state.transferPenaltyS = v))
  take('alt', (v) => intIn(v, 0, 10), (v) => (state.alternatives = v))
  take('wt', (v) => numIn(v, 0, 120), (v) => (state.wTransferMin = v))
  take('ws', (v) => numIn(v, 0, 30), (v) => (state.wStopMin = v))
  take('date', (v) => (DATE_RE.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined), (v) => (state.date = v))
  take('time', (v) => (TIME_RE.test(v) ? v : undefined), (v) => (state.time = v))
  if ((state.date == null) !== (state.time == null)) {
    if (state.date) rejected.push('date')
    if (state.time) rejected.push('time')
    state.date = state.time = undefined
  }
  return { state, rejected }
}

export function buildShare(req: PlanRequest): URLSearchParams {
  const p = new URLSearchParams()
  p.set('from', req.origin)
  p.set('to', req.destination)
  p.set('obj', req.objective)
  p.set('algo', req.algorithm)
  if (req.max_transfers != null) p.set('mt', String(req.max_transfers))
  if (req.transfer_penalty_s != null) p.set('tp', String(req.transfer_penalty_s))
  if (req.alternatives) p.set('alt', String(req.alternatives))
  if (req.objective === 'balanced') {
    if (req.w_transfer_min != null) p.set('wt', String(req.w_transfer_min))
    if (req.w_stop_min != null) p.set('ws', String(req.w_stop_min))
  }
  if (req.depart_date && req.depart_time) {
    p.set('date', req.depart_date)
    p.set('time', req.depart_time)
  }
  return p
}
