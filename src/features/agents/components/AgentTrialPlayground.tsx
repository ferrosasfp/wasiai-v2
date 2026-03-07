'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

interface Props {
  slug: string
  isAuthenticated: boolean
}

type TrialState = 'checking' | 'idle' | 'loading' | 'success' | 'error' | 'timeout' | 'used'

export function AgentTrialPlayground({ slug, isAuthenticated }: Props) {
  const t = useTranslations('trial')
  const [input, setInput] = useState('')
  const [anonLimitHit, setAnonLimitHit] = useState(false)
  // Initialize directly from prop — avoids synchronous setState in effect
  const [state, setState] = useState<TrialState>(() =>
    isAuthenticated ? 'checking' : 'idle'
  )
  const [output, setOutput] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [trialsRemaining, setTrialsRemaining] = useState<number | null>(null)
  const [trialsLimit, setTrialsLimit] = useState<number>(3)

  useEffect(() => {
    fetch(`/api/v1/agents/${slug}/trial`)
      .then(r => r.json())
      .then((data: { used: boolean; trialsRemaining?: number; limit?: number }) => {
        if (data.used) { setState('used'); return }
        setState('idle')
        if (data.trialsRemaining !== undefined) setTrialsRemaining(data.trialsRemaining)
        if (data.limit !== undefined) setTrialsLimit(data.limit)
      })
      .catch(() => setState('idle'))
  }, [slug])

  async function handleTrial() {
    setState('loading')
    setOutput(null)
    setErrorMsg(null)

    try {
      const res = await fetch(`/api/v1/agents/${slug}/trial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      })
      const data = (await res.json()) as { error?: string; output?: string }

      if (!res.ok) {
        if (data.error === 'already_used') { setState('used'); return }
        if (data.error === 'anon_rate_limited') { setAnonLimitHit(true); return }
        if (data.error === 'timeout') { setState('timeout'); return }
        setState('error')
        setErrorMsg(
          data.error === 'rate_limited' ? t('error_ratelimit') : t('error_generic')
        )
        return
      }

      setState('success')
      setOutput(data.output ?? '')
      setTrialsRemaining(prev => prev !== null ? Math.max(0, prev - 1) : null)
    } catch {
      setState('error')
      setErrorMsg(t('error_generic'))
    }
  }

  if (state === 'checking') return null

  return (
    <section className="border border-gray-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold bg-[#E84142]/10 text-[#E84142] px-2 py-1 rounded-full">
          {t('badge')}
        </span>
        {trialsRemaining !== null && state !== 'used' && !anonLimitHit && (
          <span className="text-xs text-gray-400">
            {trialsRemaining}/{trialsLimit} {t('remaining') ?? 'remaining'}
          </span>
        )}
      </div>

      {state === 'used' ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">✅ {t('used')}</p>
          <Link
            href="/keys"
            className="inline-block bg-[#E84142] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#c73535] transition-colors"
          >
            {t('cta')}
          </Link>
        </div>
      ) : (
        <>
          {anonLimitHit ? (
            <div className="space-y-3 text-center">
              <p className="text-sm text-gray-600 font-medium">
                Has alcanzado el límite de pruebas gratuitas
              </p>
              <Link
                href="/auth/login"
                className="inline-block bg-[#E84142] text-white text-sm font-semibold px-6 py-2.5 rounded-lg hover:bg-[#c73535] transition-colors"
              >
                Crear cuenta gratis →
              </Link>
            </div>
          ) : (
            <>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={t('placeholder')}
                maxLength={2000}
                rows={3}
                disabled={state === 'loading'}
                className="w-full border border-gray-200 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#E84142]/30 disabled:opacity-50"
              />

              <button
                onClick={handleTrial}
                disabled={!input.trim() || state === 'loading'}
                className="bg-[#E84142] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#c73535] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {state === 'loading' ? t('loading') : t('button')}
              </button>

              {state === 'success' && output !== null && (
                <div className="space-y-2">
                  <pre className="bg-gray-900 text-gray-100 text-xs p-4 rounded-lg overflow-auto max-h-72 whitespace-pre-wrap">
                    {output}
                  </pre>
                  <p className="text-sm text-gray-500">
                    {t('success_cta')}{' '}
                    <Link href="/keys" className="text-[#E84142] underline">{t('cta')}</Link>
                  </p>
                </div>
              )}

              {(state === 'error' || state === 'timeout') && (
                <p className="text-sm text-red-600">
                  {state === 'timeout' ? t('error_timeout') : errorMsg}
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
