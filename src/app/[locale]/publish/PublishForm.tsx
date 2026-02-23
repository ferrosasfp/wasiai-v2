'use client'

import { useState, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Image from 'next/image'
import { WalletSetup } from '@/components/WalletSetup'
// A-07: Import shared schema to keep client/server validation in sync
import { createModelSchema, MODEL_CATEGORIES, type CreateModelDraft, type ModelCapability } from '@/lib/schemas/model.schema'
// T-11: Shared file upload hook
import { useFileUpload } from '@/hooks/useFileUpload'

type PublishForm = CreateModelDraft

interface PublishFormProps {
  initialWallet: string | null
}

export default function PublishForm({ initialWallet }: PublishFormProps) {
  const params = useParams()
  const router = useRouter()
  const locale = params.locale as string

  const [form, setForm] = useState<Partial<PublishForm>>({
    category: 'nlp',
    price_per_call: 0.02,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [coverImage, setCoverImage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // T-11: Use shared upload hook instead of inline upload logic
  const { upload: uploadFile, uploading: uploadingImage, error: uploadError } = useFileUpload()

  // A-07: Use shared ModelCapability type from schema
  const [capabilities, setCapabilities] = useState<ModelCapability[]>([])

  function addCapability() {
    setCapabilities(prev => [...prev, { name: '', description: '', inputType: 'text', outputType: 'text' }])
  }
  function removeCapability(i: number) {
    setCapabilities(prev => prev.filter((_, idx) => idx !== i))
  }
  function updateCapability(i: number, field: keyof ModelCapability, value: string) {
    setCapabilities(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: value } : c))
  }

  async function handleImageUpload(file: File) {
    const result = await uploadFile(file)
    if (result) {
      setCoverImage(result.url)
    }
  }

  function handleChange(field: keyof PublishForm, value: string | number) {
    setForm(prev => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }))
    // Auto-generate slug from name
    if (field === 'name') {
      const slug = (value as string).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      setForm(prev => ({ ...prev, name: value as string, slug }))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // A-07: Using shared schema for consistent client/server validation
    const result = createModelSchema.safeParse(form)
    if (!result.success) {
      const fieldErrors: Record<string, string> = {}
      result.error.issues.forEach(i => { fieldErrors[i.path[0] as string] = i.message })
      setErrors(fieldErrors)
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...result.data, cover_image: coverImage, capabilities }),
      })
      if (!res.ok) throw new Error(await res.text())
      setSuccess(true)
      setTimeout(() => router.push(`/${locale}/creator/dashboard`), 2000)
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Error publishing model' })
    } finally {
      setLoading(false)
    }
  }

  // ── Wallet gate ─────────────────────────────────────────────────────────
  // Wallet must be set before publishing — earnings go there automatically
  if (!initialWallet) return (
    <main className="min-h-screen bg-gray-50 py-12 px-6">
      <div className="mx-auto max-w-lg">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
          <div className="text-5xl mb-4">💳</div>
          <h1 className="text-xl font-bold text-gray-900">Configura tu wallet primero</h1>
          <p className="mt-2 text-sm text-gray-600">
            Necesitas una dirección EVM para recibir pagos en USDC cuando alguien invoque tu agente.
            Sin wallet no hay a dónde enviar las ganancias.
          </p>
          <div className="mt-6 rounded-xl bg-white border border-amber-200 p-5 text-left">
            <p className="text-sm font-semibold text-gray-700 mb-3">Tu wallet de cobros (EVM / Avalanche)</p>
            <WalletSetup initialWallet={null} />
          </div>
          <p className="mt-4 text-xs text-gray-400">
            Tras guardar tu wallet, esta página se actualizará automáticamente.
          </p>
        </div>
      </div>
    </main>
  )

  if (success) return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h1 className="text-2xl font-bold text-gray-900">Model Published!</h1>
        <p className="mt-2 text-gray-500">Redirecting to dashboard...</p>
      </div>
    </div>
  )

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Publish a Model</h1>
          <p className="mt-2 text-gray-500">List your AI model on WasiAI and earn USDC per call.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 rounded-2xl bg-white p-8 shadow-sm border border-gray-100">

          {/* Cover Image */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Cover Image <span className="text-gray-400 font-normal">(optional · max 5MB)</span></label>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleImageUpload(f) }}
              className="relative flex h-36 cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 hover:border-indigo-300 hover:bg-indigo-50/30 transition"
            >
              {coverImage ? (
                <>
                  <Image src={coverImage} alt="Cover" fill className="object-cover rounded-xl" />
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); setCoverImage(null) }}
                    className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white hover:bg-black/70"
                  >
                    ✕
                  </button>
                </>
              ) : uploadingImage ? (
                <p className="text-sm text-indigo-500 animate-pulse">Uploading to IPFS…</p>
              ) : (
                <div className="text-center">
                  <p className="text-2xl">🖼️</p>
                  <p className="mt-1 text-sm text-gray-500">Click or drag & drop</p>
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
            {/* T-11: Show upload error from useFileUpload hook OR form validation error */}
            {(uploadError || errors.cover_image) && (
              <p className="mt-1 text-xs text-red-500">{uploadError ?? errors.cover_image}</p>
            )}
          </div>

          {/* Name */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Model Name</label>
            <input
              type="text"
              value={form.name ?? ''}
              onChange={e => handleChange('name', e.target.value)}
              placeholder="GPT Spanish Translator"
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
            {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
          </div>

          {/* Slug */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Slug (URL)</label>
            <div className="flex items-center rounded-xl border border-gray-200 overflow-hidden">
              <span className="bg-gray-50 px-3 py-2.5 text-sm text-gray-400 border-r border-gray-200">{(process.env.NEXT_PUBLIC_SITE_URL ?? 'wasiai-v2.vercel.app').replace(/https?:\/\//, '')}/models/</span>
              <input
                type="text"
                value={form.slug ?? ''}
                onChange={e => handleChange('slug', e.target.value)}
                placeholder="gpt-spanish-translator"
                className="flex-1 px-3 py-2.5 text-sm focus:outline-none"
              />
            </div>
            {errors.slug && <p className="mt-1 text-xs text-red-500">{errors.slug}</p>}
          </div>

          {/* Category + Price */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Category</label>
              <select
                value={form.category}
                onChange={e => handleChange('category', e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none"
              >
                {MODEL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Price per call (USDC)</label>
              <div className="flex items-center rounded-xl border border-gray-200 overflow-hidden">
                <span className="bg-gray-50 px-3 py-2.5 text-sm text-gray-400 border-r border-gray-200">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={form.price_per_call ?? ''}
                  onChange={e => handleChange('price_per_call', parseFloat(e.target.value))}
                  className="flex-1 px-3 py-2.5 text-sm focus:outline-none"
                />
              </div>
              {errors.price_per_call && <p className="mt-1 text-xs text-red-500">{errors.price_per_call}</p>}
            </div>
          </div>

          {/* Endpoint */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">API Endpoint</label>
            <input
              type="url"
              value={form.endpoint_url ?? ''}
              onChange={e => handleChange('endpoint_url', e.target.value)}
              placeholder="https://your-api.com/predict"
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
            {errors.endpoint_url && <p className="mt-1 text-xs text-red-500">{errors.endpoint_url}</p>}
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Description</label>
            <textarea
              value={form.description ?? ''}
              onChange={e => handleChange('description', e.target.value)}
              placeholder="Describe what your model does, what inputs it accepts and what outputs it returns..."
              rows={4}
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
            {errors.description && <p className="mt-1 text-xs text-red-500">{errors.description}</p>}
          </div>

          {/* Capabilities — UX-11 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">Capabilities <span className="text-gray-400 font-normal">(optional)</span></label>
              <button type="button" onClick={addCapability} className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition">
                + Add Capability
              </button>
            </div>
            {capabilities.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 py-4 text-center text-sm text-gray-400">
                Define what your model can do — inputs, outputs, examples
              </div>
            ) : (
              <div className="space-y-3">
                {capabilities.map((cap, i) => (
                  <div key={i} className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-500">Capability {i + 1}</span>
                      <button type="button" onClick={() => removeCapability(i)} className="text-xs text-red-400 hover:text-red-600">✕ Remove</button>
                    </div>
                    <input
                      placeholder="Name (e.g. summarize)"
                      value={cap.name}
                      onChange={e => updateCapability(i, 'name', e.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
                    />
                    <input
                      placeholder="Description"
                      value={cap.description}
                      onChange={e => updateCapability(i, 'description', e.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select value={cap.inputType} onChange={e => updateCapability(i, 'inputType', e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none">
                        {['text','image','audio','json'].map(t => <option key={t} value={t}>Input: {t}</option>)}
                      </select>
                      <select value={cap.outputType} onChange={e => updateCapability(i, 'outputType', e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none">
                        {['text','image','audio','json'].map(t => <option key={t} value={t}>Output: {t}</option>)}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Revenue info */}
          <div className="rounded-xl bg-indigo-50 p-4 text-sm text-indigo-700">
            💰 You earn <strong>90%</strong> of every call · WasiAI takes 10% · Paid instantly in USDC
          </div>

          {errors.form && <p className="text-sm text-red-500">{errors.form}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-indigo-600 py-3 font-semibold text-white hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {loading ? 'Publishing...' : 'Publish Model →'}
          </button>
        </form>
      </div>
    </main>
  )
}
