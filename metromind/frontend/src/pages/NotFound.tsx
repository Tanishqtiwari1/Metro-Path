import { Compass } from 'lucide-react'
import { Link } from 'react-router-dom'
import { buttonVariants, EmptyState } from '@/components/ui'

export default function NotFound() {
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={<Compass />}
        title="This stop isn't on the map"
        action={
          <Link to="/" className={buttonVariants()}>
            Back to MetroMind
          </Link>
        }
      >
        The page you asked for doesn't exist. Check the address or head back to the start.
      </EmptyState>
    </div>
  )
}
