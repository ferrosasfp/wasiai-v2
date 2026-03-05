// src/app/[locale]/creator/dashboard/_components/WebhooksPanel.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { WEBHOOK_EVENTS } from '@/lib/webhooks/events'
import { useTranslations } from 'next-intl'

interface Webhook {
  id: string
  url: string
  events: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

interface Delivery {
  id: string
  event: string
  success: boolean
  status_code: number | null
  attempt: number
  delivered_at: string
  error_message?: string | null
}

export function WebhooksPanel() {
  const t = useTranslations('webhooks')
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deliveriesMap, setDeliveriesMap] = useState<Record<string, Delivery[]>>({})
  const [formUrl, setFormUrl] = useState('')
  const [formEvents, setFormEvents] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setDeliveriesMap({})
    try {
      const res = await fetch('/api/v1/webhooks')
      const json = await res.json() as { webhooks?: Webhook[] }
      setWebhooks(json.webhooks ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleCreate() {
    if (!formUrl || formEvents.length === 0) {
      setError('URL y al menos un evento son requeridos')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: formUrl, events: formEvents }),
      })
      const json = await res.json() as { error?: string; secret?: string; webhook?: Webhook }
      if (!res.ok) {
        setError(json.error ?? 'Error al crear webhook')
        return
      }
      if (json.secret) setNewSecret(json.secret)
      if (json.webhook) setWebhooks(prev => [json.webhook!, ...prev])
      setShowForm(false)
      setFormUrl('')
      setFormEvents([])
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(webhook: Webhook) {
    const next = !webhook.is_active
    setWebhooks(prev => prev.map(w => w.id === webhook.id ? { ...w, is_active: next } : w))
    const res = await fetch(`/api/v1/webhooks/${webhook.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: next }),
    })
    if (!res.ok) {
      setWebhooks(prev => prev.map(w => w.id === webhook.id ? { ...w, is_active: webhook.is_active } : w))
      setError('Error al actualizar el webhook. Intenta de nuevo.')
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este webhook?')) return
    const res = await fetch(`/api/v1/webhooks/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setWebhooks(prev => prev.filter(w => w.id !== id))
    } else {
      setError('Error al eliminar el webhook. Intenta de nuevo.')
    }
  }

  async function handleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    if (!deliveriesMap[id]) {
      try {
        const res = await fetch(`/api/v1/webhooks/${id}/deliveries`)
        const json = await res.json() as { deliveries?: Delivery[] }
        setDeliveriesMap(prev => ({ ...prev, [id]: json.deliveries ?? [] }))
      } catch {
        setDeliveriesMap(prev => ({ ...prev, [id]: [] }))
        setError('Error al cargar las deliveries del webhook.')
      }
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-6">
        <p className="text-sm text-gray-400">{t('loading')}</p>
      </div>
    )
  }

  return (
    <section className="rounded-2xl border border-gray-100 bg-white shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">{t('title')}</h2>
        <button
          onClick={() => { setShowForm(s => !s); setError(null) }}
          className="rounded-xl bg-avax-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-avax-600 transition"
        >
          {showForm ? t('cancelWebhook') : t('newWebhook')}
        </button>
      </div>

      {/* Secret one-time banner */}
      {newSecret && (
        <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-4 space-y-2">
          <p className="text-sm font-semibold text-yellow-800">
            ⚠️ Guarda tu secret ahora — no se mostrará de nuevo
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-yellow-100 px-2 py-1 text-xs font-mono text-yellow-900 break-all">
              {newSecret}
            </code>
            <button
              onClick={() => { void navigator.clipboard.writeText(newSecret) }}
              className="shrink-0 rounded-lg border border-yellow-300 px-2 py-1 text-xs text-yellow-700 hover:bg-yellow-100"
            >
              {t('copy')}
            </button>
          </div>
          <button
            onClick={() => setNewSecret(null)}
            className="text-xs text-yellow-700 underline"
          >
            {t('saved')}
          </button>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{t('urlLabel')}</label>
            <input
              type="url"
              placeholder="https://mi-servidor.com/webhook"
              value={formUrl}
              onChange={e => setFormUrl(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-avax-500 focus:outline-none focus:ring-1 focus:ring-avax-500"
            />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-700 mb-2">{t('events')}</p>
            <div className="space-y-1">
              {WEBHOOK_EVENTS.map(ev => (
                <label key={ev} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formEvents.includes(ev)}
                    onChange={e => {
                      setFormEvents(prev =>
                        e.target.checked ? [...prev, ev] : prev.filter(x => x !== ev)
                      )
                    }}
                    className="rounded border-gray-300 text-avax-500"
                  />
                  <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{ev}</code>
                </label>
              ))}
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            onClick={() => { void handleCreate() }}
            disabled={saving}
            className="rounded-xl bg-avax-500 px-4 py-2 text-sm font-semibold text-white hover:bg-avax-600 transition disabled:opacity-50"
          >
            {saving ? 'Creando...' : 'Crear webhook'}
          </button>
        </div>
      )}

      {/* Webhook list */}
      {webhooks.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">{t('noWebhooks')}</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {webhooks.map(wh => (
            <div key={wh.id} className="py-3 space-y-2">
              <div className="flex items-start gap-3">
                {/* Toggle switch — patrón de FreeTrialToggle.tsx */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={wh.is_active}
                  aria-label="Activar/desactivar webhook"
                  onClick={() => { void handleToggle(wh) }}
                  className={`mt-0.5 relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-avax-500 focus:ring-offset-2 ${
                    wh.is_active ? 'bg-avax-500' : 'bg-gray-200'
                  }`}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                    wh.is_active ? 'translate-x-4' : 'translate-x-0'
                  }`} />
                </button>

                {/* URL + badges */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{wh.url}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {wh.events.map(ev => (
                      <span key={ev} className="rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-xs font-medium">
                        {ev}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Creado {new Date(wh.created_at).toLocaleDateString('es')}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { void handleExpand(wh.id) }}
                    className="text-xs text-gray-500 hover:text-gray-700 underline"
                  >
                    {expandedId === wh.id ? 'Ocultar' : 'Deliveries'}
                  </button>
                  <button
                    onClick={() => { void handleDelete(wh.id) }}
                    className="text-xs text-red-500 hover:text-red-700"
                    aria-label="Eliminar webhook"
                  >
                    Eliminar
                  </button>
                </div>
              </div>

              {/* Deliveries expandibles */}
              {expandedId === wh.id && (
                <div className="ml-12 rounded-xl border border-gray-100 bg-gray-50 overflow-hidden">
                  {!deliveriesMap[wh.id] ? (
                    <p className="p-3 text-xs text-gray-400">Cargando...</p>
                  ) : deliveriesMap[wh.id].length === 0 ? (
                    <p className="p-3 text-xs text-gray-400">Sin deliveries registradas.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="border-b border-gray-100 bg-gray-100 text-gray-500 uppercase tracking-wide">
                        <tr>
                          <th className="px-3 py-2 text-left">Evento</th>
                          <th className="px-3 py-2 text-center">Status</th>
                          <th className="px-3 py-2 text-center">HTTP</th>
                          <th className="px-3 py-2 text-center">Intento</th>
                          <th className="px-3 py-2 text-right">Fecha</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {deliveriesMap[wh.id].map(d => (
                          <tr key={d.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono">{d.event}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`rounded-full px-2 py-0.5 font-medium ${
                                d.success
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-red-100 text-red-600'
                              }`}>
                                {d.success ? '✓ OK' : '✗ Fail'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-center text-gray-600">{d.status_code ?? '—'}</td>
                            <td className="px-3 py-2 text-center text-gray-600">{d.attempt}</td>
                            <td className="px-3 py-2 text-right text-gray-400">
                              {new Date(d.delivered_at).toLocaleString('es')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
