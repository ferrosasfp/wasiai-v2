// src/features/creator/components/AgentExamples.tsx
// HU-4.3: Editor CRUD de ejemplos Input/Output para el creator dashboard
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import type { AgentExample } from '@/features/models/types/models.types'

interface AgentExamplesProps {
  agentId: string
}

const MAX_EXAMPLES = 5

export function AgentExamples({ agentId }: AgentExamplesProps) {
  const t = useTranslations('examples')
  const [examples, setExamples]     = useState<AgentExample[]>([])
  const [loading, setLoading]       = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [form, setForm]             = useState({ label: '', input: '', output: '' })
  const [error, setError]           = useState<string | null>(null)
  // Ref to avoid setState after unmount (pattern from CreatorAnalytics)
  const activeRef = useRef(true)

  // M-04: fetchExamples unificado — usado tanto en useEffect inicial como en callbacks
  const fetchExamples = useCallback(async () => {
    const res = await fetch(`/api/creator/agents/${agentId}/examples`)
    if (res.ok) {
      const { examples: data } = await res.json()
      if (activeRef.current) setExamples(data)
    }
    if (activeRef.current) setLoading(false)
  }, [agentId])

  useEffect(() => {
    activeRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchExamples()
    return () => { activeRef.current = false }
  }, [fetchExamples])

  const canAdd = examples.length < MAX_EXAMPLES

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const method = editingId ? 'PATCH' : 'POST'
    const url    = editingId
      ? `/api/creator/agents/${agentId}/examples/${editingId}`
      : `/api/creator/agents/${agentId}/examples`

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    if (!res.ok) {
      const { error: msg } = await res.json()
      setError(msg ?? t('unknownError'))
    } else {
      setForm({ label: '', input: '', output: '' })
      setEditingId(null)
      await fetchExamples()
    }
    setSubmitting(false)
  }

  async function handleDelete(exId: string) {
    if (!confirm(t('confirmDelete'))) return
    await fetch(`/api/creator/agents/${agentId}/examples/${exId}`, { method: 'DELETE' })
    await fetchExamples()
  }

  function handleEdit(ex: AgentExample) {
    setEditingId(ex.id)
    setForm({ label: ex.label ?? '', input: ex.input, output: ex.output })
  }

  function handleCancelEdit() {
    setEditingId(null)
    setForm({ label: '', input: '', output: '' })
    setError(null)
  }

  if (loading) {
    return <div className="py-4 text-sm text-gray-400">{t('loading')}</div>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">{t('title')}</h3>
        <span className="text-xs text-gray-400">{examples.length}/{MAX_EXAMPLES}</span>
      </div>

      {/* Lista de ejemplos existentes */}
      {examples.map((ex, i) => (
        <div key={ex.id} className="rounded-xl border border-gray-200 p-4 text-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-gray-700">
              {ex.label || `${t('example')} ${i + 1}`}
            </span>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => handleEdit(ex)}
                className="text-xs text-blue-600 hover:underline"
              >
                {t('edit')}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(ex.id)}
                className="text-xs text-red-600 hover:underline"
              >
                {t('delete')}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded bg-gray-50 p-2">
              <p className="text-gray-400 mb-1 font-medium">{t('inputLabel')}</p>
              <p className="font-mono text-gray-700 whitespace-pre-wrap">{ex.input}</p>
            </div>
            <div className="rounded bg-green-50 p-2">
              <p className="text-green-600 mb-1 font-medium">{t('outputLabel')}</p>
              <p className="font-mono text-green-800 whitespace-pre-wrap">{ex.output}</p>
            </div>
          </div>
        </div>
      ))}

      {/* Formulario agregar / editar */}
      {(canAdd || editingId) && (
        <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-dashed border-gray-300 p-4">
          <h4 className="text-sm font-medium text-gray-700">
            {editingId ? t('editing') : t('add')}
          </h4>

          <input
            type="text"
            placeholder={t('tagLabel')}
            value={form.label}
            onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
            maxLength={60}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <div>
            <label className="block text-xs text-gray-500 mb-1">
              {t('inputLabel')} <span className="text-gray-400">{t('maxInputChars')}</span>
            </label>
            <textarea
              value={form.input}
              onChange={e => setForm(f => ({ ...f, input: e.target.value }))}
              maxLength={500}
              rows={3}
              required
              placeholder={t('inputPlaceholder')}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-right text-[10px] text-gray-400">{form.input.length}/500</p>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">
              {t('outputLabel')} <span className="text-gray-400">{t('maxOutputChars')}</span>
            </label>
            <textarea
              value={form.output}
              onChange={e => setForm(f => ({ ...f, output: e.target.value }))}
              maxLength={1000}
              rows={4}
              required
              placeholder={t('outputPlaceholder')}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-right text-[10px] text-gray-400">{form.output.length}/1000</p>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {submitting ? t('saving') : editingId ? t('saveChanges') : t('add')}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={handleCancelEdit}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition"
              >
                {t('cancel')}
              </button>
            )}
          </div>
        </form>
      )}

      {/* Mensaje límite alcanzado */}
      {!canAdd && !editingId && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 font-medium">
          {t('maxReached')}
        </p>
      )}
    </div>
  )
}
