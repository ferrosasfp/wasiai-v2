'use client'

import { useState, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Image from 'next/image'
import { z } from 'zod'

const MODEL_CATEGORIES = ['nlp', 'vision', 'audio', 'code', 'multimodal', 'data'] as const

const publishSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters'),
  slug: z.string().min(3).regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers and hyphens'),
  description: z.string().min(10, 'Please add a description'),
  category: z.enum(MODEL_CATEGORIES),
  price_per_call: z.number().min(0.01, 'Minimum price is $0.01').max(100),
  endpoint_url: z.string().url('Must be a valid URL'),
})

type PublishForm = z.infer<typeof publishSchema>

export default function PublishForm() {
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
  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  type Capability = { name: string; description: string; inputType: string; outputType: string }
  const [capabilities, setCapabilities] = useState<Capability[]>([])

  function addCapability() {
    setCapabilities(prev => [...prev, { name: '', description: '', inputType: 'text', outputType: 'text' }])
  }
  function removeCapability(i: number) {
    setCapabilities(prev => prev.filter((_, idx) => idx !== i))
  }
  function updateCapability(i: number, field: keyof Capability, value: string) {
    setCapabilities(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: value } : c))
  }

  async function handleImageUpload(file: File) {
    setUploadingImage(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/storage/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Upload failed')
      setCoverImage(data.url)
    } catch (err) {
      setErrors(prev => ({ ...prev, cover_image: err instanceof Error ? err.message : 'Upload error' }))
    } finally {
      setUploadingImage(false)
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
    const result = publishSchema.safeParse(form)
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
            {errors.cover_image && <p className="mt-1 text-xs text-red-500">{errors.cover_image}</p>}
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
