'use client'

import { useEffect, useState } from 'react'
import type { CBState } from '@/lib/circuit-breaker/CircuitBreaker'

interface Props {
  slug: string
}

const BADGE_CONFIG: Record<CBState, { label: string; className: string }> = {
  closed:      { label: '● Online',        className: 'bg-green-100 text-green-700' },
  open:        { label: '● Circuit Open',  className: 'bg-red-100 text-red-700' },
  'half-open': { label: '● Recovering',    className: 'bg-yellow-100 text-yellow-700' },
}

export function AgentCBBadge({ slug }: Props) {
  const [state, setState] = useState<CBState>('closed')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/v1/agents/${slug}/cb-status`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) { setLoading(false); return null }
        return r.json()
      })
      .then((d: { state?: CBState } | null) => {
        if (d?.state) setState(d.state)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [slug])

  if (loading) return null

  const config = BADGE_CONFIG[state]
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  )
}
