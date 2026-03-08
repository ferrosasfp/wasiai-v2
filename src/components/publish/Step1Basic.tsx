'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Upload, X } from 'lucide-react'
import { MODEL_CATEGORIES, type CreateModelDraft } from '@/lib/schemas/model.schema'
import { useFileUpload } from '@/hooks/useFileUpload'

interface Props {
  data: Partial<CreateModelDraft>
  onChange: (field: string, value: unknown) => void
  errors: Record<string, string>
  onNext: () => void
  saving?: boolean
}

const CATEGORY_ICONS: Record<string, string> = {
  nlp: '💬', vision: '👁️', audio: '🎵', code: '💻', multimodal: '🤖', data: '📊',
}

const CATEGORY_DESC_KEYS: Record<string, string> = {
  nlp:        'categoryNlpDesc',
  vision:     'categoryVisionDesc',
  audio:      'categoryAudioDesc',
  code:       'categoryCodeDesc',
  multimodal: 'categoryMultimodalDesc',
  data:       'categoryDataDesc',
}

const MAX_DESC = 500

export function Step1Basic({ data, onChange, errors, onNext, saving }: Props) {
  const t = useTranslations('publish')
  const tCommon = useTranslations('common')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { upload, uploading, error: uploadError } = useFileUpload()
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({})
  const [dragOver, setDragOver] = useState(false)

  async function handleImageUpload(file: File) {
    const result = await upload(file)
    if (result) onChange('cover_image', result.url)
  }

  function handleNext() {
    const errs: Record<string, string> = {}
    if (!data.name || data.name.trim().length < 3)        errs.name        = t('step1.errorNameMin')
    if (!data.description || data.description.trim().length < 10) errs.description = t('step1.errorDescriptionMin')
    if (!data.category)                                    errs.category    = t('step1.selectCategory')
    if (Object.keys(errs).length > 0) {
      setLocalErrors(errs)
      const el = document.querySelector(`[data-field="${Object.keys(errs)[0]}"]`) as HTMLElement | null
      el?.focus()
      return
    }
    setLocalErrors({})
    onNext()
  }

  const allErrors = { ...localErrors, ...errors }
  const descLen   = (data.description ?? '').length
  const nameSlug  = (data.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

  return (
    <div className="space-y-6 rounded-2xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm">
      <div>
        <h2 className="text-xl font-bold text-gray-900">{t('step1.title')}</h2>
        <p className="mt-1 text-sm text-gray-500">{t('step1.subtitle')}</p>
      </div>

      {/* ── Cover image — C mejorada ──────────────────────────────────────── */}
      <div>
        <label className="mb-2 block text-sm font-semibold text-gray-700">
          {t('coverImage')} <span className="font-normal text-gray-400 text-xs">({t('coverImageHint')})</span>
        </label>

        {data.cover_image ? (
          /* Estado: imagen subida */
          <div className="relative h-32 w-32 overflow-hidden rounded-2xl border-2 border-avax-200 shadow-sm">
            <Image src={data.cover_image} alt={t('coverImage')} fill className="object-cover" sizes="128px" />
            <button
              type="button"
              onClick={() => onChange('cover_image', null)}
              className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          /* Estado: vacío / drag & drop */
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault(); setDragOver(false)
              const f = e.dataTransfer.files[0]
              if (f) handleImageUpload(f)
            }}
            className={`flex h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed transition ${
              dragOver
                ? 'border-avax-400 bg-avax-50'
                : 'border-gray-200 bg-gray-50 hover:border-avax-300 hover:bg-avax-50/40'
            }`}
          >
            {uploading ? (
              <p className="animate-pulse text-sm text-avax-500">{t('coverImageUploading')}</p>
            ) : (
              <>
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl transition ${dragOver ? 'bg-avax-100' : 'bg-gray-100'}`}>
                  <Upload size={18} className={dragOver ? 'text-avax-500' : 'text-gray-400'} />
                </div>
                <p className="text-sm font-medium text-gray-600">
                  {dragOver ? t('coverImageDropActive') : t('coverImageDrop')}
                </p>
                <p className="text-xs text-gray-400">PNG, JPG, WebP, GIF</p>
              </>
            )}
          </div>
        )}

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

      {/* ── Agent name — D con slug live ────────────────────────────────── */}
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-gray-700">
          {t('step1.agentName')} <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          data-field="name"
          value={data.name ?? ''}
          onChange={e => {
            onChange('name', e.target.value)
            if (localErrors.name) setLocalErrors(prev => { const n = { ...prev }; delete n.name; return n })
          }}
          placeholder={t('step1NamePlaceholder')}
          className={`w-full rounded-xl border px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100 transition ${
            allErrors.name ? 'border-red-400 bg-red-50' : 'border-gray-200'
          }`}
        />
        {/* Slug generado en vivo */}
        {nameSlug && !allErrors.name && (
          <p className="mt-1.5 text-xs text-gray-400">
            {t('slugLabel')}: <span className="font-mono text-gray-600">{nameSlug}</span>
          </p>
        )}
        {allErrors.name && <p className="mt-1 text-xs text-red-500">{allErrors.name}</p>}
      </div>

      {/* ── Description — D con contador y hint ─────────────────────────── */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <label className="text-sm font-semibold text-gray-700">
            {t('description')} <span className="text-red-500">*</span>
          </label>
          <span className={`text-xs tabular-nums ${descLen >= MAX_DESC ? 'text-red-500' : 'text-gray-400'}`}>
            {descLen}/{MAX_DESC}
          </span>
        </div>
        <p className="mb-2 text-xs text-gray-400">{t('descriptionGuide')}</p>
        <textarea
          data-field="description"
          value={data.description ?? ''}
          onChange={e => {
            if (e.target.value.length <= MAX_DESC) onChange('description', e.target.value)
            if (localErrors.description) setLocalErrors(prev => { const n = { ...prev }; delete n.description; return n })
          }}
          placeholder={t('step1DescPlaceholder')}
          rows={4}
          className={`w-full rounded-xl border px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100 transition resize-none ${
            allErrors.description ? 'border-red-400 bg-red-50' : 'border-gray-200'
          }`}
        />
        {allErrors.description && <p className="mt-1 text-xs text-red-500">{allErrors.description}</p>}
      </div>

      {/* ── Category — D con chips visuales ─────────────────────────────── */}
      <div>
        <label className="mb-2 block text-sm font-semibold text-gray-700">
          {t('category')} <span className="text-red-400">*</span>
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {MODEL_CATEGORIES.map(c => (
            <button
              key={c}
              type="button"
              data-field="category"
              onClick={() => {
                onChange('category', c)
                if (localErrors.category) setLocalErrors(prev => { const n = { ...prev }; delete n.category; return n })
              }}
              className={`flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition ${
                data.category === c
                  ? 'border-avax-400 bg-avax-50 ring-1 ring-avax-300'
                  : 'border-gray-200 hover:border-avax-200 hover:bg-gray-50'
              }`}
            >
              <span className="text-base">{CATEGORY_ICONS[c] ?? '🔧'}</span>
              <span className="text-xs font-semibold text-gray-800 capitalize">{c}</span>
              <span className="text-[10px] text-gray-400 leading-tight">{t(CATEGORY_DESC_KEYS[c] ?? 'category')}</span>
            </button>
          ))}
        </div>
        {allErrors.category && <p className="mt-1 text-xs text-red-500">{allErrors.category}</p>}
      </div>

      {/* Actions */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleNext}
          disabled={(saving ?? false) || uploading}
          className="rounded-xl bg-avax-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 transition disabled:opacity-50 shadow-sm"
        >
          {saving ? tCommon('saving') : t('cta.next')} →
        </button>
      </div>
    </div>
  )
}
