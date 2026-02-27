// src/features/models/components/AgentExamplesDisplay.tsx
// HU-4.3: Accordion público de ejemplos — Server Component (sin 'use client')
// AC-7: Accordion nativo con <details>/<summary> — sin JS de cliente
// AC-8: Si no hay ejemplos → retorna null (sección invisible)

import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'

interface AgentExamplesDisplayProps {
  agentId: string
}

export async function AgentExamplesDisplay({ agentId }: AgentExamplesDisplayProps) {
  // M-02: usar cliente anon (no service role) — datos públicos, RLS aplica correctamente
  const supabase = await createClient()
  const t = await getTranslations('examples')

  const { data: examples, error } = await supabase
    .from('agent_examples')
    .select('id, label, input, output, created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: true })  // AC-4: orden de creación

  // AC-8: si no hay ejemplos → sección invisible (retornar null, no empty state)
  if (error || !examples || examples.length === 0) return null

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
      <h2 className="mb-4 font-semibold text-gray-900">{t('title')}</h2>
      <div className="space-y-2">
        {examples.map((ex, i) => (
          // <details>/<summary> nativo: accordion sin JS, accesible por defecto
          <details key={ex.id} className="group rounded-xl border border-gray-100 overflow-hidden">
            <summary className="flex cursor-pointer items-center justify-between bg-gray-50 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-100 transition select-none list-none">
              <span>{ex.label || `${t('example')} ${i + 1}`}</span>
              {/* Icono chevron que rota al abrir */}
              <svg
                className="h-4 w-4 text-gray-400 transition-transform duration-200 group-open:rotate-90"
                fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </summary>
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  {t('inputLabel')}
                </p>
                <p className="text-xs font-mono text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {ex.input}
                </p>
              </div>
              <div className="rounded-lg bg-green-50 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-green-500">
                  {t('outputLabel')}
                </p>
                <p className="text-xs font-mono text-green-800 whitespace-pre-wrap leading-relaxed">
                  {ex.output}
                </p>
              </div>
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}
