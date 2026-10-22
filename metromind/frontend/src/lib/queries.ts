import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from './api'

// Retry transient failures once; a missing dataset or a client error will not fix itself.
const retryOnce = (count: number, err: Error) =>
  count < 1 && !(err instanceof ApiError && (err.code === 'no_dataset' || (err.status >= 400 && err.status < 500)))

export const useMeta = () => useQuery({ queryKey: ['meta'], queryFn: api.meta, staleTime: 60_000, retry: retryOnce })

export const useNetworkMap = () =>
  useQuery({ queryKey: ['network-map'], queryFn: api.networkMap, staleTime: 5 * 60_000, retry: retryOnce })

/** Map of line id -> {name, color} from the active dataset. */
export function useLines() {
  const q = useNetworkMap()
  const lines = new Map((q.data?.lines ?? []).map((l) => [l.id, l]))
  return { lines, isLoading: q.isLoading }
}

/** Station id -> summary for labelling (uses the already-cached map payload). */
export function useStationIndex() {
  const q = useNetworkMap()
  return new Map((q.data?.stations ?? []).map((s) => [s.id, s]))
}
