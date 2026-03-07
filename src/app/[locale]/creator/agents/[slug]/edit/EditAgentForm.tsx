'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createModelSchema, MODEL_CATEGORIES } from '@/lib/schemas/model.schema'
import { useFileUpload } from '@/hooks/useFileUpload'
import { CapabilitiesEditor } from '@/features/publish/CapabilitiesEditor'
import type { CapabilitiesEditorRef } from '@/features/publish/CapabilitiesEditor'
import type { CapabilityPayload } from '@/features/publish/types'
import { useWallet } from '@/features/wallet/hooks/useWallet'
import { createPublicClient, http, encodeFunctionData } from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'
import { WASIAI_MARKETPLACE_ABI, toUSDCAtomics } from '@/lib/contracts/WasiAIMarketplace'


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
  capabilities?: unknown[]
  free_trial_enabled?: boolean
  free_trial_limit?: number
  max_rpm?: number
  max_rpd?: number
  registration_type?: string
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const capabilitiesEditorRef = useRef<CapabilitiesEditorRef>(null)
  const { upload, uploading, error: uploadError } = useFileUpload()

  const [form, setForm] = useState({
    name: agent.name,
    description: agent.description ?? '',
    category: agent.category as (typeof MODEL_CATEGORIES)[number],
    price_per_call: agent.price_per_call,
    endpoint_url: agent.endpoint_url ?? '',
    cover_image: agent.cover_image ?? null,
    capabilities: (agent.capabilities ?? []) as CapabilityPayload[],
    free_trial_enabled: agent.free_trial_enabled ?? false,
    free_trial_limit: agent.free_trial_limit ?? 1,
    max_rpm: agent.max_rpm ?? 60,
    max_rpd: agent.max_rpd ?? 1000,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const { address: walletAddress, isConnected: walletConnected } = useWallet()

  function handleChange(field: keyof typeof form, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }))
    if (errors[field as string]) setErrors(prev => ({ ...prev, [field as string]: '' }))
  }

  async function handleImageUpload(file: File) {
    const result = await upload(file)
    if (result) handleChange('cover_image', result.url)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Validate capabilities editor before schema check
    const capsValid = capabilitiesEditorRef.current?.validate() ?? true
    if (!capsValid) return

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

      // WAS-161: If agent is on-chain and price changed, sync with contract (creator signs)
      const priceChanged = result.data.price_per_call !== agent.price_per_call
      if (agent.registration_type === 'on_chain' && priceChanged && walletConnected && walletAddress) {
        try {
          const win = window as Window & { ethereum?: { request: (args: { method: string; params: unknown[] }) => Promise<string> } }
          if (win.ethereum) {
            const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
            const contractAddress = chainId === 43114
              ? (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET ?? '')
              : (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI ?? '')

            const data = encodeFunctionData({
              abi: WASIAI_MARKETPLACE_ABI,
              functionName: 'updateAgent',
              args: [agent.slug, toUSDCAtomics(result.data.price_per_call!)],
            })

            const txHash = await win.ethereum.request({
              method: 'eth_sendTransaction',
              params: [{ from: walletAddress, to: contractAddress, data }],
            })

            // Wait for confirmation
            const chain = chainId === 43114 ? avalanche : avalancheFuji
            const publicClient = createPublicClient({ chain, transport: http() })
            await publicClient.waitForTransactionReceipt({
              hash: txHash as `0x${string}`,
              timeout: 60_000,
            })
          }
        } catch (err) {
          // Non-fatal: DB already updated. Log but don't block.
          console.warn('[WAS-161] On-chain price sync failed:', err)
        }
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
          {/* Cover image */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Imagen de portada <span className="font-normal text-gray-400">(opcional)</span>
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleImageUpload(f) }}
              className="relative flex h-32 cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 hover:border-avax-300 hover:bg-avax-50/30 transition"
            >
              {form.cover_image ? (
                <>
                  <Image src={form.cover_image} alt="Cover" fill className="object-cover rounded-xl" />
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); handleChange('cover_image', null) }}
                    className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white hover:bg-black/70"
                  >✕</button>
                </>
              ) : uploading ? (
                <p className="animate-pulse text-sm text-avax-500">Subiendo imagen…</p>
              ) : (
                <div className="text-center">
                  <p className="text-2xl">🖼️</p>
                  <p className="mt-1 text-sm text-gray-500">Arrastra o haz clic para subir</p>
                  <p className="text-xs text-gray-400">PNG, JPG, WebP, GIF</p>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f) }}
            />
            {uploadError && <p className="mt-1 text-xs text-red-500">{uploadError}</p>}
          </div>

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

          {/* Capabilities */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Capacidades <span className="font-normal text-gray-400">(opcional)</span>
            </label>
            <CapabilitiesEditor
              ref={capabilitiesEditorRef}
              value={form.capabilities}
              onChange={caps => handleChange('capabilities', caps)}
            />
          </div>

          {/* Free trial */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-700">Trial gratuito</label>
                <p className="text-xs text-gray-400">Permite a los usuarios probar el agente gratis</p>
              </div>
              <button
                type="button"
                onClick={() => handleChange('free_trial_enabled', !form.free_trial_enabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${form.free_trial_enabled ? 'bg-avax-500' : 'bg-gray-200'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${form.free_trial_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            {form.free_trial_enabled && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Número de trials por usuario</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={form.free_trial_limit}
                  onChange={e => handleChange('free_trial_limit', parseInt(e.target.value) || 1)}
                  className="w-32 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-avax-400 focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* Rate limits */}
          <details className="group rounded-xl border border-gray-100 bg-gray-50">
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-gray-600 hover:text-gray-900">
              ⚙️ Límites de rate <span className="font-normal text-gray-400">(opcional)</span>
            </summary>
            <div className="space-y-4 px-4 pb-4 pt-2">
              <p className="text-xs text-gray-400">Controla cuántas llamadas puede hacer un usuario por minuto o día.</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Req / minuto (RPM)</label>
                  <input
                    type="number"
                    min={1}
                    max={600}
                    value={form.max_rpm}
                    onChange={e => handleChange('max_rpm', parseInt(e.target.value) || 60)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-avax-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Req / día (RPD)</label>
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    value={form.max_rpd}
                    onChange={e => handleChange('max_rpd', parseInt(e.target.value) || 1000)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-avax-400 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </details>

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
