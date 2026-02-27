'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { CreateModelDraft, ModelCapability } from '@/lib/schemas/model.schema'
import { StepIndicator } from '@/components/publish/StepIndicator'
import { AgentCardPreview } from '@/components/publish/AgentCardPreview'
import { Step1Basic } from '@/components/publish/Step1Basic'
import { Step2Product } from '@/components/publish/Step2Product'
import { Step3Technical } from '@/components/publish/Step3Technical'

// Type for agent data from DB (when loading a draft)
interface AgentDraft {
  slug: string
  name?: string
  description?: string
  category?: string
  price_per_call?: number
  capabilities?: unknown
  endpoint_url?: string
  cover_image?: string | null
}

interface Props {
  initialDraft: AgentDraft | null
  from?: string  // 'onboarding' para redirect correcto al publicar
}

// FormData allows schema fields + extra form-only fields
type FormData = Partial<CreateModelDraft> & Record<string, unknown>

function inferStep(draft: AgentDraft | null): 1 | 2 | 3 {
  if (!draft) return 1
  if (draft.endpoint_url) return 3
  if (draft.price_per_call !== undefined) return 2
  return 1
}

export default function PublishForm({ initialDraft, from }: Props) {
  const params = useParams()
  const router = useRouter()
  const locale = params.locale as string
  const t = useTranslations('publish')

  const [step, setStep] = useState<1 | 2 | 3>(inferStep(initialDraft))
  const [data, setData] = useState<FormData>(() => {
    if (!initialDraft) return { category: 'nlp', price_per_call: 0.02 } as FormData
    const caps = Array.isArray(initialDraft.capabilities)
      ? (initialDraft.capabilities as ModelCapability[])
      : ([] as ModelCapability[])
    return { ...initialDraft, capabilities: caps } as unknown as FormData
  })
  const [draftSlug, setDraftSlug] = useState<string | null>(initialDraft?.slug ?? null)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showDraftModal, setShowDraftModal] = useState(!!initialDraft)

  function handleChange(field: string, value: unknown) {
    setData(prev => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors(prev => { const e = { ...prev }; delete e[field]; return e })
  }

  // Paso 1 → 2: guardar draft en DB
  async function handleStep1Next() {
    setSaving(true)
    try {
      const body = { ...data, status: 'draft' }
      const url = draftSlug
        ? `/api/creator/agents/${draftSlug}`
        : '/api/models'
      const method = draftSlug ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json() as Record<string, unknown>
      if (!res.ok) {
        if (json.fields) {
          setErrors(json.fields as Record<string, string>)
        } else if (json.details && Array.isArray(json.details)) {
          // Map Zod validation issues to field errors
          const fieldErrors: Record<string, string> = {}
          for (const issue of json.details as Array<{ path: string[]; message: string }>) {
            const field = issue.path[0] ?? '_form'
            fieldErrors[field] = issue.message
          }
          setErrors(fieldErrors)
        } else {
          setErrors({ name: (json.error as string) ?? t('form.errorSaving') })
        }
        return
      }
      if (!draftSlug && json.slug) setDraftSlug(json.slug as string)
      setStep(2)
    } finally {
      setSaving(false)
    }
  }

  // Paso 2 → 3: actualizar draft
  async function handleStep2Next() {
    if (!draftSlug) { setStep(3); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/creator/agents/${draftSlug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          price_per_call: data.price_per_call,
          capabilities: data.capabilities,
        }),
      })
      if (!res.ok) {
        const json = await res.json() as Record<string, unknown>
        setErrors((json.fields as Record<string, string>) ?? { price_per_call: (json.error as string) ?? t('form.errorSaving') })
        return
      }
      setStep(3)
    } finally {
      setSaving(false)
    }
  }

  // Paso 3: publicar
  async function handlePublish() {
    if (!draftSlug) return
    setPublishing(true)
    try {
      // Guardar campos técnicos
      const patchRes = await fetch(`/api/creator/agents/${draftSlug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint_url: data.endpoint_url }),
      })
      if (!patchRes.ok) {
        const json = await patchRes.json() as Record<string, unknown>
        setErrors((json.fields as Record<string, string>) ?? { endpoint_url: (json.error as string) ?? t('form.errorSaving') })
        return
      }
      // Activar
      const statusRes = await fetch(`/api/creator/agents/${draftSlug}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      })
      if (!statusRes.ok) {
        setErrors({ endpoint_url: t('form.errorPublishing') })
        return
      }
      // Redirect
      const redirectPath = from === 'onboarding'
        ? `/${locale}/onboarding?published=true`
        : `/${locale}/creator/dashboard`
      router.push(redirectPath)
    } finally {
      setPublishing(false)
    }
  }

  async function handleDiscardDraft() {
    if (!draftSlug) { setShowDraftModal(false); return }
    await fetch(`/api/creator/agents/${draftSlug}`, { method: 'DELETE' })
    setDraftSlug(null)
    setData({ category: 'nlp', price_per_call: 0.02 })
    setStep(1)
    setShowDraftModal(false)
  }

  // Preview data — only fields the AgentCardPreview needs
  const previewData = {
    name: data.name as string | undefined,
    description: data.description as string | undefined,
    category: data.category as string | undefined,
    price_per_call: data.price_per_call as number | undefined,
    cover_image: data.cover_image as string | null | undefined,
  }

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      {/* Draft modal */}
      {showDraftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
            <h2 className="mb-2 text-lg font-bold text-gray-900">Tienes un borrador sin publicar</h2>
            <p className="mb-6 text-sm text-gray-500">¿Quieres continuar donde lo dejaste?</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDraftModal(false)}
                className="flex-1 rounded-xl bg-avax-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 transition"
              >
                Continuar borrador
              </button>
              <button
                onClick={handleDiscardDraft}
                className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition"
              >
                Descartar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Publicar agente</h1>
          <p className="mt-2 text-gray-500">Lista tu agente de IA en WasiAI y gana USDC por cada llamada.</p>
        </div>

        <StepIndicator currentStep={step} />

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr,320px]">
          <div>
            {step === 1 && (
              <Step1Basic
                data={data as Partial<CreateModelDraft>}
                onChange={handleChange}
                errors={errors}
                onNext={handleStep1Next}
                saving={saving}
              />
            )}
            {step === 2 && (
              <Step2Product
                data={data as Partial<CreateModelDraft>}
                onChange={handleChange}
                errors={errors}
                onNext={handleStep2Next}
                onBack={() => setStep(1)}
                saving={saving}
              />
            )}
            {step === 3 && (
              <Step3Technical
                data={data as Partial<CreateModelDraft>}
                onChange={handleChange}
                errors={errors}
                onPublish={handlePublish}
                onBack={() => setStep(2)}
                publishing={publishing}
              />
            )}
          </div>
          <div className="lg:sticky lg:top-8">
            <AgentCardPreview data={previewData} />
          </div>
        </div>
      </div>
    </main>
  )
}
