'use client'

import { useState } from 'react'
import { ModelCard } from '@/features/models/components/ModelCard'
import type { Model } from '@/features/models/types/models.types'

interface PublishPreviewProps {
  locale: string
  formData: {
    name?: string
    description?: string
    category?: string
    price_per_call?: number
    agent_type?: string
    cover_image?: string | null
    slug?: string
  }
  previewLabel: string   // "Vista previa" (i18n, resuelto desde PublishForm)
  showLabel: string      // "Ver preview" (mobile)
  hideLabel: string      // "Ocultar preview" (mobile)
}

export function PublishPreview({
  locale,
  formData,
  previewLabel,
  showLabel,
  hideLabel,
}: PublishPreviewProps) {
  const [collapsed, setCollapsed] = useState(true) // mobile: colapsado por defecto

  // Construir objeto Model con defaults seguros para preview
  const previewModel: Model = {
    id: 'preview',
    slug: formData.slug ?? 'preview',
    name: formData.name ?? '',
    description: formData.description ?? null,
    category: (formData.category as Model['category']) ?? 'nlp',
    price_per_call: formData.price_per_call ?? 0,
    currency: 'USDC',
    chain: 'avalanche',
    agent_type: (formData.agent_type as Model['agent_type']) ?? 'model',
    cover_image: formData.cover_image ?? null,
    total_calls: 0,
    total_revenue: 0,
    is_featured: false,
    on_chain_registered: false,
    registration_type: 'off_chain',
    token_id: null,
    chain_registered_at: null,
    erc8004_id: null,
    reputation_score: null,
    reputation_count: 0,
    creator: undefined,
    status: 'active',
    creator_id: '',
    endpoint_url: null,
    capabilities: [],
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    dependencies: [],
    creator_wallet: null,
    mcp_tool_name: null,
    mcp_description: null,
    free_trial_enabled: false,
    free_trial_limit: 0,
    long_running: false,
  }

  return (
    <>
      {/* Botón toggle — solo visible en mobile */}
      <div className="sm:hidden mb-4">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-700"
        >
          <span>{collapsed ? showLabel : hideLabel}</span>
          <svg
            className={`h-4 w-4 transition-transform ${collapsed ? '' : 'rotate-180'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Panel de preview: oculto en mobile cuando colapsado, siempre visible en desktop */}
      <div className={collapsed ? 'hidden sm:block' : 'block'}>
        {/* Badge "Preview" */}
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-full bg-avax-50 border border-avax-100 px-3 py-1 text-xs font-semibold text-avax-600">
            {previewLabel}
          </span>
        </div>

        {/* ModelCard no interactivo — pointer-events-none para evitar clicks en preview */}
        <div className="pointer-events-none select-none opacity-95">
          <ModelCard model={previewModel} locale={locale} index={0} />
        </div>
      </div>
    </>
  )
}
