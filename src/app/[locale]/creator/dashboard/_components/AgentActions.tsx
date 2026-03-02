'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AgentCBBadge } from './AgentCBBadge'

interface AgentActionsProps {
  slug: string
  locale: string
  currentStatus: string
  agentName: string
}

export function AgentActions({ slug, locale, currentStatus, agentName }: AgentActionsProps) {
  const router = useRouter()
  const [status, setStatus] = useState(currentStatus)
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [loadingDelete, setLoadingDelete] = useState(false)

  async function handleToggleStatus() {
    const nextStatus = status === 'active' ? 'paused' : 'active'
    setLoadingStatus(true)
    // Optimistic update
    setStatus(nextStatus)
    try {
      const res = await fetch(`/api/creator/agents/${slug}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      if (!res.ok) {
        // Revert on failure
        setStatus(status)
        console.error('Failed to update status', await res.text())
      } else {
        router.refresh()
      }
    } catch {
      setStatus(status)
    } finally {
      setLoadingStatus(false)
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${agentName}"? This cannot be undone.`,
    )
    if (!confirmed) return

    setLoadingDelete(true)
    try {
      const res = await fetch(`/api/creator/agents/${slug}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        console.error('Failed to delete agent', await res.text())
      } else {
        router.refresh()
      }
    } catch {
      console.error('Delete request failed')
    } finally {
      setLoadingDelete(false)
    }
  }

  const isPaused = status === 'paused'
  const isDeleted = status === 'deleted'

  return (
    <div className="flex items-center gap-2">
      {/* CB Status Badge */}
      <AgentCBBadge slug={slug} />

      {/* Edit */}
      <Link
        href={`/${locale}/creator/agents/${slug}/edit`}
        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition"
      >
        ✏️ Edit
      </Link>

      {/* Pause / Resume — hidden for deleted agents */}
      {!isDeleted && (
        <button
          onClick={handleToggleStatus}
          disabled={loadingStatus}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
            isPaused
              ? 'bg-green-100 text-green-700 hover:bg-green-200'
              : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
          }`}
        >
          {loadingStatus
            ? '...'
            : isPaused
            ? '▶ Resume'
            : '⏸ Pause'}
        </button>
      )}

      {/* Delete */}
      <button
        onClick={handleDelete}
        disabled={loadingDelete}
        className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition disabled:opacity-50"
      >
        {loadingDelete ? '...' : '🗑 Delete'}
      </button>
    </div>
  )
}
