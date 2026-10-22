import { buildShare, parseShare } from '@/lib/share'

describe('shareable route URLs', () => {
  it('round-trips a valid request', () => {
    const p = buildShare({
      origin: '21',
      destination: '81',
      objective: 'balanced',
      algorithm: 'astar',
      max_transfers: 2,
      transfer_penalty_s: 240,
      alternatives: 3,
      w_transfer_min: 4,
      w_stop_min: 0.5,
      depart_date: '2025-12-25',
      depart_time: '08:30',
    })
    const { state, rejected } = parseShare(p)
    expect(rejected).toEqual([])
    expect(state).toMatchObject({
      origin: '21',
      destination: '81',
      objective: 'balanced',
      algorithm: 'astar',
      maxTransfers: 2,
      transferPenaltyS: 240,
      alternatives: 3,
      wTransferMin: 4,
      wStopMin: 0.5,
      date: '2025-12-25',
      time: '08:30',
    })
  })

  it('rejects invalid or hostile values instead of trusting them', () => {
    const { state, rejected } = parseShare(
      new URLSearchParams({ from: '<script>', to: '81', obj: 'warp', algo: 'astar', mt: '99', tp: '-5', time: '25:99' }),
    )
    expect(state.origin).toBeUndefined()
    expect(state.destination).toBe('81')
    expect(state.objective).toBeUndefined()
    expect(rejected).toEqual(expect.arrayContaining(['from', 'obj', 'mt', 'tp', 'time']))
  })

  it('requires date and time together', () => {
    const { state, rejected } = parseShare(new URLSearchParams({ from: '1', to: '2', date: '2025-01-01' }))
    expect(state.date).toBeUndefined()
    expect(rejected).toContain('date')
  })
})
