'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createModelSchema, MODEL_CATEGORIES } from '@/lib/schemas/model.schema'

// Agent row shape returned from Supabase select('*')
interface AgentRow {
  id: string
  slug: string
  name: string
  description: string | null
  category: string
  price_per_call: number
  endpoint_url: string
  cover_image?: string | null
  status: string
  creator_id: string
  [key: string]: unknown
}

interface EditAgentFormProps {
  agent: AgentRow
  locale: string
}

// A-07: Partial schema — only the editable fields, no slug
const updateSchema = createModelSchema
  .omit({ slug: true })
  .partial()
  .required({ name: true, category: true, price_per_call: true, endpoint_url: true })

export function EditAgentForm({ agent, locale }: EditAgentFormProps) {
  const router = useRouter()
  const t = useTranslations('editAgent')
  const tCommon = useTranslations('common')

  const [form, setForm] = useState({
    name: agent.name,
    description: agent.description ?? '',
    category: agent.category as (typeof MODEL_CATEGORIES)[number],
    price_per_call: agent.price_per_call,
    endpoint_url: agent.endpoint_url,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  function handleChange(field: keyof typeof form, value: string | number) {
    setForm(prev => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // A-07: Validate with partial schema before sending
    const result = updateSchema.safeParse(form)
    if (!result.success) {
      const fieldErrors: Record<string, string> = {}
      result.error.issues.forEach(i => { fieldErrors[i.path[0] as string] = i.message })
      setErrors(fieldErrors)
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/creator/agents/${agent.slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result.data),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }))
        setErrors({ form: data.error ?? t('errorUpdate') })
        return
      }

      setSuccess(true)
      router.push(`/${locale}/creator/dashboard`)
    } catch {
      setErrors({ form: t('errorNetwork') })
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-5xl mb-4">✅</div>
          <h1 className="text-2xl font-bold text-gray-900">{t('updated')}</h1>
          <p className="mt-2 text-gray-500">{t('redirecting')}</p>
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <Link
            href={`/${locale}/creator/dashboard`}
            className="text-sm text-gray-500 hover:text-avax-600 transition"
          >
            {t('backToDashboard')}
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">{t('title')}</h1>
          <p className="mt-1 text-gray-500 text-sm">
            <span className="font-mono text-gray-400">{agent.slug}</span>
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-6 rounded-2xl bg-white p-8 shadow-sm border border-gray-100"
        >
          {/* Name */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              {t('agentName')}
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => handleChange('name', e.target.value)}
              placeholder="GPT Spanish Translator"
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100"
            />
            {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
          </div>

          {/* Category + Price */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">{t('category')}</label>
              <select
                value={form.category}
                onChange={e => handleChange('category', e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none"
              >
                {MODEL_CATEGORIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {errors.category && <p className="mt-1 text-xs text-red-500">{errors.category}</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                {t('pricePerCall')}
              </label>
              <div className="flex items-center rounded-xl border border-gray-200 overflow-hidden">
                <span className="bg-gray-50 px-3 py-2.5 text-sm text-gray-400 border-r border-gray-200">$</span>
                <input
                  type="number"
                  step="0.001"
                  min="0.01"
                  value={form.price_per_call}
                  onChange={e => handleChange('price_per_call', parseFloat(e.target.value))}
                  className="flex-1 px-3 py-2.5 text-sm focus:outline-none"
                />
              </div>
              {errors.price_per_call && (
                <p className="mt-1 text-xs text-red-500">{errors.price_per_call}</p>
              )}
            </div>
          </div>

          {/* Endpoint */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">{t('apiEndpoint')}</label>
            <input
              type="url"
              value={form.endpoint_url}
              onChange={e => handleChange('endpoint_url', e.target.value)}
              placeholder="https://your-api.com/predict"
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100"
            />
            {errors.endpoint_url && (
              <p className="mt-1 text-xs text-red-500">{errors.endpoint_url}</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">{t('description')}</label>
            <textarea
              value={form.description}
              onChange={e => handleChange('description', e.target.value)}
              placeholder="Describe what your agent does, inputs it accepts and outputs it returns…"
              rows={4}
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100"
            />
            {errors.description && (
              <p className="mt-1 text-xs text-red-500">{errors.description}</p>
            )}
          </div>

          {errors.form && (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{errors.form}</p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-xl bg-avax-500 py-3 font-semibold text-white hover:bg-avax-600 transition disabled:opacity-50"
            >
              {loading ? t('saving') : t('saveChanges')}
            </button>
            <Link
              href={`/${locale}/creator/dashboard`}
              className="rounded-xl border border-gray-200 px-6 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 transition"
            >
              {tCommon('cancel')}
            </Link>
          </div>
        </form>
      </div>
    </main>
  )
}
