import { DatabaseZap, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button, buttonVariants, EmptyState, Skeleton } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { useMeta } from '@/lib/queries'
import type { Meta } from '@/lib/types'

/** Renders children only when an active dataset exists; otherwise an honest empty/error state. */
export function DataGate({ children }: { children: (meta: Meta) => ReactNode }) {
  const meta = useMeta()
  if (meta.isLoading)
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-6 w-60" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  if (meta.error) {
    const e = meta.error
    const noData = e instanceof ApiError && e.code === 'no_dataset'
    return (
      <EmptyState
        icon={<DatabaseZap />}
        title={noData ? 'No transit dataset is active' : 'The API is unavailable'}
        action={
          noData ? (
            <Link to="/data" className={buttonVariants()}>
              Import a GTFS feed
            </Link>
          ) : (
            <Button variant="outline" onClick={() => meta.refetch()}>
              <RefreshCw /> Retry
            </Button>
          )
        }
      >
        {noData
          ? 'MetroMind only works with real imported data. An administrator needs to upload a GTFS ZIP on the Dataset page.'
          : e.message}
      </EmptyState>
    )
  }
  return <>{children(meta.data!)}</>
}
