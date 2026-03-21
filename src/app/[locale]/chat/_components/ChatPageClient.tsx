'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useLocale } from 'next-intl'
import { Eye, EyeOff } from 'lucide-react'

interface ChatStep {
  agent_slug: string
  cost_usdc: string
  status: 'success' | 'error'
}

interface ChatReceipt {
  step: number
  agent_slug: string
  cost_usdc: string
  receipt_signature: string
}

interface ChatResponse {
  answer: string
  steps: ChatStep[]
  receipts: ChatReceipt[]
  total_cost_usdc: string
  pipeline_id: string
}

const STORAGE_KEY = 'wasi_api_key'

export function ChatPageClient() {
  const t = useTranslations('chat')
  const locale = useLocale()

  const [question, setQuestion] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ChatResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [receiptsOpen, setReceiptsOpen] = useState(false)

  // Load API key from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) setApiKey(stored)
  }, [])

  function handleApiKeyChange(val: string) {
    setApiKey(val)
    localStorage.setItem(STORAGE_KEY, val)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!question.trim() || !apiKey.trim()) return

    setLoading(true)
    setResult(null)
    setError(null)
    setReceiptsOpen(false)

    try {
      const res = await fetch('/api/v1/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({ question }),
      })

      const data = await res.json() as ChatResponse & { error?: string; code?: string }

      if (!res.ok) {
        if (data.code === 'no_agents_matched') {
          setError(t('noAgents'))
        } else {
          setError(data.error ?? t('errorGeneric'))
        }
        // AC5: preserve partial steps even on error
        if (data.steps?.length) {
          setResult(data)
        }
      } else {
        setResult(data)
      }
    } catch {
      setError(t('errorGeneric'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-10">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">{t('title')}</h1>
          <p className="mt-2 text-gray-500">{t('subtitle')}</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* API Key */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('apiKeyLabel')}</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                placeholder="wasi_..."
                className="w-full rounded-lg border border-gray-200 px-3 py-2 pr-10 text-sm text-gray-900 placeholder-gray-400 focus:border-avax-500 focus:outline-none focus:ring-1 focus:ring-avax-500"
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600"
                aria-label={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {!apiKey && (
              <p className="mt-1.5 text-sm text-amber-600">
                {t('noKey')}{' '}
                <Link href={`/${locale}/models`} className="font-medium underline hover:text-amber-700">
                  {t('getKey')}
                </Link>
              </p>
            )}
          </div>

          {/* Question */}
          <div>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={t('placeholder')}
              maxLength={500}
              rows={3}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-avax-500 focus:outline-none focus:ring-1 focus:ring-avax-500 resize-none"
            />
            <div className="mt-1 text-right text-xs text-gray-400">{question.length}/500</div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !question.trim() || !apiKey.trim()}
            className="w-full rounded-lg bg-avax-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-avax-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? t('loading') : t('send')}
          </button>
        </form>

        {/* Loading */}
        {loading && (
          <div className="mt-8 flex items-center justify-center gap-3 text-gray-500">
            <svg className="h-5 w-5 animate-spin text-avax-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm">{t('loading')}</span>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Result */}
        {result && !loading && (
          <div className="mt-8 space-y-4">
            {/* Summary */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">{t('summary')}</h2>
              <p className="text-sm leading-relaxed text-gray-800">{result.answer}</p>
            </div>

            {/* Total cost */}
            <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-4 py-3 text-sm shadow-sm">
              <span className="font-medium text-gray-600">{t('totalCost')}</span>
              <span className="font-bold text-avax-600">{result.total_cost_usdc} USDC</span>
            </div>

            {/* Steps */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">{t('steps')}</h2>
              <ul className="space-y-2">
                {result.steps.map((step, i) => (
                  <li key={i} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                    <span className="text-sm font-medium text-gray-700">{step.agent_slug}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">{step.cost_usdc} USDC</span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                          step.status === 'success'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {step.status}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Receipts (collapsible) */}
            {result.receipts.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                <button
                  type="button"
                  onClick={() => setReceiptsOpen(!receiptsOpen)}
                  className="flex w-full items-center justify-between px-5 py-3 text-left"
                >
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">{t('receipts')}</h2>
                  <svg
                    className={`h-4 w-4 text-gray-400 transition-transform ${receiptsOpen ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {receiptsOpen && (
                  <ul className="divide-y divide-gray-100 px-5 pb-4">
                    {result.receipts.map((receipt, i) => (
                      <li key={i} className="py-2 text-xs text-gray-600">
                        <div className="font-medium text-gray-700">{receipt.agent_slug}</div>
                        <div className="mt-0.5 truncate font-mono text-gray-400">
                          {receipt.receipt_signature.slice(0, 20)}…{receipt.receipt_signature.slice(-8)}
                        </div>
                        <div className="mt-0.5 text-gray-400">{receipt.cost_usdc} USDC</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
