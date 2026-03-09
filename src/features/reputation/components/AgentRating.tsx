'use client'

/**
 * AgentRating — ERC-8004 Reputation Registry UI
 *
 * Thumbs up/down after interacting with an agent.
 * Integrates with POST /api/v1/models/[slug]/rate
 */

import { useState, useEffect, useCallback } from 'react'
import { useWallet }                         from '@/features/wallet/hooks/useWallet'
import { useTranslations }                   from 'next-intl'

interface Props {
  slug:             string
  initialScore:     number | null
  initialCount:     number
  compact?:         boolean   // small inline variant for ModelCard
}

export function AgentRating({ slug, initialScore, initialCount, compact = false }: Props) {
  const { address } = useWallet()

  const [score, setScore]     = useState<number | null>(initialScore)
  const t = useTranslations('rating')
  const [count, setCount]     = useState(initialCount)
  const [yourVote, setYourVote] = useState<'up' | 'down' | null>(null)
  const [loading, setLoading] = useState(false)
  const [voted, setVoted]     = useState(false)

  // Load existing vote if wallet connected
  useEffect(() => {
    if (!address) return
    fetch(`/api/v1/models/${slug}/rate?wallet=${address}`)
      .then(r => r.json())
      .then(d => {
        if (d.your_vote) setYourVote(d.your_vote)
      })
      .catch(() => null)
  }, [slug, address])

  const vote = useCallback(async (rating: 'up' | 'down') => {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/models/${slug}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, wallet: address }),
      })
      const data = await res.json()
      if (res.ok) {
        setScore(data.reputation_score)
        setCount(data.reputation_count)
        setYourVote(rating)
        setVoted(true)
      }
    } finally {
      setLoading(false)
    }
  }, [slug, address, loading])

  if (compact) {
    // Small badge for ModelCard
    if (score === null || count === 0) return null
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
        <span className="text-green-500">👍</span>
        <span className="font-medium">{score}%</span>
        <span className="text-gray-400">({count})</span>
      </span>
    )
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-700">{t('rateThis')}</p>
          <p className="text-xs text-gray-400 mt-0.5">ERC-8004 · On-chain reputation</p>
        </div>
        {score !== null && count > 0 && (
          <div className="text-right">
            <p className="text-xl font-bold text-gray-900">{score}%</p>
            <p className="text-xs text-gray-400">{count} {count === 1 ? 'vote' : 'votes'}</p>
          </div>
        )}
      </div>

      {/* Score bar */}
      {score !== null && count > 0 && (
        <div className="mb-4 h-1.5 w-full rounded-full bg-gray-100">
          <div
            className="h-1.5 rounded-full bg-gradient-to-r from-avax-500 to-avax-700 transition-all duration-500"
            style={{ width: `${score}%` }}
          />
        </div>
      )}

      {/* Buttons */}
      {voted ? (
        <div className="flex items-center justify-center gap-2 py-2 text-sm text-gray-500">
          <span>{yourVote === 'up' ? '👍' : '👎'}</span>
          <span>{t('thanks')}</span>
        </div>
      ) : (
        <div className="flex gap-3">
          <button
            onClick={() => vote('up')}
            disabled={loading || yourVote === 'up'}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition
              ${yourVote === 'up'
                ? 'bg-green-100 text-green-700 border border-green-200'
                : 'bg-gray-50 text-gray-700 border border-gray-200 hover:bg-green-50 hover:border-green-200 hover:text-green-700'}
              disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            👍 {t('up')}
          </button>
          <button
            onClick={() => vote('down')}
            disabled={loading || yourVote === 'down'}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition
              ${yourVote === 'down'
                ? 'bg-red-100 text-red-700 border border-red-200'
                : 'bg-gray-50 text-gray-700 border border-gray-200 hover:bg-red-50 hover:border-red-200 hover:text-red-700'}
              disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            👎 {t('down')}
          </button>
        </div>
      )}

      {count === 0 && !voted && (
        <p className="mt-2 text-center text-xs text-gray-400">{t('beFirst')}</p>
      )}
    </div>
  )
}
