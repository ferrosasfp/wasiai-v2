'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { MODEL_CATEGORIES, type CreateModelDraft } from '@/lib/schemas/model.schema'
import { useFileUpload } from '@/hooks/useFileUpload'

interface Props {
  data: Partial<CreateModelDraft>
  onChange: (field: string, value: unknown) => void
  errors: Record<string, string>
  onNext: () => void
  saving?: boolean
}

export function Step1Basic({ data, onChange, errors, onNext, saving }: Props) {
  const t = useTranslations('publish')
  const tCommon = useTranslations('common')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { upload, uploading, error: uploadError } = useFileUpload()
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({})

  async function handleImageUpload(file: File) {
    const result = await upload(file)
    if (result) {
      onChange('cover_image', result.url)
    }
  }

  function handleNext() {
    const errs: Record<string, string> = {}
    if (!data.name || data.name.trim().length < 3) {
      errs.name = t('step1.errorNameMin')
    }
    if (!data.description || data.description.trim().length < 10) {
      errs.description = t('step1.errorDescriptionMin')
    }
    if (!data.category) {
      errs.category = t('step1.selectCategory')
    }
    if (Object.keys(errs).length > 0) {
      setLocalErrors(errs)
      const firstField = Object.keys(errs)[0]
      const el = document.querySelector(`[data-field="${firstField}"]`) as HTMLElement | null
      el?.focus()
      return
    }
    setLocalErrors({})
    onNext()
  }

  // Merge server + local errors — server errors take precedence
  const allErrors = { ...localErrors, ...errors }

  return (
    <div className="space-y-6 rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
      <div>
        <h2 className="text-xl font-bold text-gray-900">{t('step1.title')}</h2>
        <p className="mt-1 text-sm text-gray-500">{t('step1.subtitle')}</p>
      </div>

      {/* Cover image */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          {t('coverImage')} <span className="font-normal text-gray-400">({t('coverImageHint')})</span>
        </label>
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault()
            const f = e.dataTransfer.files[0]
            if (f) handleImageUpload(f)
          }}
          className="relative flex h-36 cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 hover:border-avax-300 hover:bg-avax-50/30 transition"
        >
          {data.cover_image ? (
            <>
              <Image src={data.cover_image} alt="Cover" fill className="object-cover rounded-xl" />
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onChange('cover_image', null) }}
                className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white hover:bg-black/70"
              >
                ✕
              </button>
            </>
          ) : uploading ? (
            <p className="animate-pulse text-sm text-avax-500">{t('step1.uploadingIPFS')}</p>
          ) : (
            <div className="text-center">
              <p className="text-2xl">🖼️</p>
              <p className="mt-1 text-sm text-gray-500">{t('step1.dropHint')}</p>
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
        {(uploadError ?? allErrors.cover_image) && (
          <p className="mt-1 text-xs text-red-500">{uploadError ?? allErrors.cover_image}</p>
        )}
      </div>

      {/* Name */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          {t('step1.agentName')} <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          data-field="name"
          value={data.name ?? ''}
          onChange={e => {
            onChange('name', e.target.value)
            if (localErrors.name) setLocalErrors(prev => { const e = { ...prev }; delete e.name; return e })
          }}
          placeholder={t('step1NamePlaceholder')}
          className={`w-full rounded-xl border px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100 ${allErrors.name ? 'border-red-400' : 'border-gray-200'}`}
        />
        {allErrors.name && <p className="mt-1 text-xs text-red-500">{allErrors.name}</p>}
      </div>

      {/* Description */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          {t('description')} <span className="text-red-500">*</span>
          <span className="ml-2 font-normal text-gray-400 text-xs">{t('descriptionHint')}</span>
        </label>
        <textarea
          data-field="description"
          value={data.description ?? ''}
          onChange={e => {
            onChange('description', e.target.value)
            if (localErrors.description) setLocalErrors(prev => { const e = { ...prev }; delete e.description; return e })
          }}
          placeholder={t('step1DescPlaceholder')}
          rows={4}
          className={`w-full rounded-xl border px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100 ${allErrors.description ? 'border-red-400' : 'border-gray-200'}`}
        />
        {allErrors.description && <p className="mt-1 text-xs text-red-500">{allErrors.description}</p>}
      </div>

      {/* Category */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          {t('category')} <span className="text-red-400">*</span>
        </label>
        <select
          data-field="category"
          value={data.category ?? ''}
          onChange={e => {
            onChange('category', e.target.value)
            if (localErrors.category) setLocalErrors(prev => { const e = { ...prev }; delete e.category; return e })
          }}
          className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none"
        >
          <option value="" disabled>{t('step1.selectCategory')}</option>
          {MODEL_CATEGORIES.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {allErrors.category && <p className="mt-1 text-xs text-red-500">{allErrors.category}</p>}
      </div>

      {/* Actions */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleNext}
          disabled={(saving ?? false) || uploading}
          className="rounded-xl bg-avax-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 transition disabled:opacity-50"
        >
          {saving ? tCommon('saving') : t('cta.next')} →
        </button>
      </div>
    </div>
  )
}
