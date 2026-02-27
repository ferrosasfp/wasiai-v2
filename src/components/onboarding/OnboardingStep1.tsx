'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

interface Props {
  displayName: string
  bio:         string
}

export function OnboardingStep1({ displayName, bio }: Props) {
  const t       = useTranslations('onboarding.step1')
  const tCommon = useTranslations('common')
  const router  = useRouter()

  const [name, setName]       = useState(displayName)
  const [bioVal, setBioVal]   = useState(bio)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('El nombre es requerido')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/creator/profile', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          display_name:    name.trim(),
          bio:             bioVal.trim(),
          onboarding_step: 2,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? t('errorSavingProfile'))

      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
      <div className="mb-6 text-center">
        <div className="text-4xl mb-3">👋</div>
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Nombre <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={e => { setName(e.target.value); setError(null) }}
            placeholder={t('namePlaceholder')}
            required
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Bio{' '}
            <span className="text-gray-400 font-normal">({bioVal.length}/160)</span>
          </label>
          <textarea
            value={bioVal}
            onChange={e => setBioVal(e.target.value.slice(0, 160))}
            placeholder={t('bioPlaceholder')}
            rows={3}
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100 resize-none"
          />
        </div>

        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="w-full rounded-xl bg-avax-500 py-3 font-semibold text-white hover:bg-avax-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? tCommon('saving') : t('cta')}
        </button>
      </form>
    </div>
  )
}
