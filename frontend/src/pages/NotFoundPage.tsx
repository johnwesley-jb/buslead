import { Link } from 'react-router'
import { EmptyState } from '@/components/ui'

export function NotFoundPage() {
  return (
    <EmptyState title="This page does not exist" action={<Link to="/" className="font-medium text-teal-deep underline underline-offset-2">Go to the dashboard</Link>}>
      The link may be old, or the address may have a typo.
    </EmptyState>
  )
}
