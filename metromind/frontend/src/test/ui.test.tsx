import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { DataGate } from '@/components/DataGate'
import { StationCombobox } from '@/components/StationCombobox'
import { TooltipProvider } from '@/components/ui'
import { PrefsProvider } from '@/lib/prefs'
import type { StationSummary } from '@/lib/types'

// Test fixtures only: a fake API response shape for component tests.
const STATIONS: StationSummary[] = [
  { id: 'S1', name: 'Alpha', lat: 1, lon: 1, lines: ['red'], interchange: false, routable: true },
  { id: 'S2', name: 'Alpha Junction', lat: 1, lon: 2, lines: ['red', 'blue'], interchange: true, routable: true },
]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <PrefsProvider>
        <TooltipProvider>
          <MemoryRouter>{ui}</MemoryRouter>
        </TooltipProvider>
      </PrefsProvider>
    </QueryClientProvider>,
  )
}

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  Element.prototype.scrollIntoView ??= () => {}
})

afterEach(() => vi.restoreAllMocks())

describe('StationCombobox', () => {
  it('searches the API and selects a station with the keyboard', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/network/map')) return jsonResponse({ stations: STATIONS, routes: [], lines: [], bounds: null })
      return jsonResponse({ items: STATIONS, total: 2, limit: 12, offset: 0 })
    })
    const onChange = vi.fn()
    wrap(<StationCombobox label="Origin" value={null} onChange={onChange} />)
    const input = screen.getByRole('combobox', { name: 'Origin' })
    await userEvent.type(input, 'alp')
    expect(await screen.findByRole('option', { name: /Alpha Junction/ })).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/stations?q=alp'))).toBe(true)
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith(STATIONS[1])
  })

  it('shows an error state when the API is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    wrap(<StationCombobox label="Origin" value={null} onChange={() => {}} />)
    await userEvent.type(screen.getByRole('combobox', { name: 'Origin' }), 'x')
    expect(await screen.findByText(/Cannot reach the MetroMind API/)).toBeInTheDocument()
  })
})

describe('DataGate', () => {
  it('shows an honest empty state when no dataset is imported', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: { code: 'no_dataset', message: 'No valid dataset has been imported yet.', details: {} } }, 503),
    )
    wrap(<DataGate>{() => <div>should not render</div>}</DataGate>)
    expect(await screen.findByText('No transit dataset is active')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Import a GTFS feed' })).toHaveAttribute('href', '/data')
    expect(screen.queryByText('should not render')).not.toBeInTheDocument()
  })

  it('renders children once metadata loads', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ dataset: { id: 7 }, counts: { stations: 2 } }))
    wrap(<DataGate>{(m) => <div>dataset {m.dataset.id}</div>}</DataGate>)
    await waitFor(() => expect(screen.getByText('dataset 7')).toBeInTheDocument())
  })
})
