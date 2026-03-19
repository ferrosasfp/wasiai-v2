'use client'

import { useState } from 'react'

interface WebhookSecretWidgetProps {
  slug: string
}

type WidgetState = 'hidden' | 'loading' | 'revealed' | 'rotating' | 'rotated'

export function WebhookSecretWidget({ slug }: WebhookSecretWidgetProps) {
  const [state, setState] = useState<WidgetState>('hidden')
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleReveal() {
    setState('loading')
    setError(null)
    try {
      const res = await fetch(`/api/creator/agents/${slug}/webhook-secret`)
      const json = await res.json() as { webhook_secret?: string; error?: string }
      if (!res.ok) {
        setError(json.error ?? 'Error al obtener el secret')
        setState('hidden')
        return
      }
      setSecret(json.webhook_secret ?? null)
      setState('revealed')
    } catch {
      setError('Error de red')
      setState('hidden')
    }
  }

  async function handleRotate() {
    if (!confirm('¿Rotar el secret? Las llamadas con el secret anterior fallarán inmediatamente.')) return
    setState('rotating')
    setError(null)
    try {
      const res = await fetch(`/api/creator/agents/${slug}/webhook-secret/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json() as { webhook_secret?: string; error?: string }
      if (!res.ok) {
        setError(json.error ?? 'Error al rotar el secret')
        setState('revealed')
        return
      }
      setSecret(json.webhook_secret ?? null)
      setState('rotated')
    } catch {
      setError('Error de red')
      setState('revealed')
    }
  }

  async function handleCopy(value: string) {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500">Webhook Secret</span>

        {state === 'hidden' && (
          <button
            onClick={() => { void handleReveal() }}
            className="text-xs text-avax-500 hover:text-avax-600 underline"
          >
            Mostrar secret
          </button>
        )}

        {state === 'loading' && (
          <span className="text-xs text-gray-400">Cargando...</span>
        )}

        {(state === 'revealed' || state === 'rotating') && secret && (
          <>
            <code className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-700 break-all">
              {secret.slice(0, 12)}•••{secret.slice(-6)}
            </code>
            <button
              onClick={() => { void handleCopy(secret) }}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              {copied ? 'Copiado ✓' : 'Copiar'}
            </button>
            <button
              onClick={() => setState('hidden')}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Ocultar
            </button>
            <button
              onClick={() => { void handleRotate() }}
              disabled={state === 'rotating'}
              className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
            >
              {state === 'rotating' ? 'Rotando...' : 'Rotar secret'}
            </button>
          </>
        )}
      </div>

      {/* Banner de secret rotado — UX igual a WebhooksPanel */}
      {state === 'rotated' && secret && (
        <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-4 space-y-2">
          <p className="text-sm font-semibold text-yellow-800">
            ⚠️ Nuevo secret generado — guarda este valor ahora, no se mostrará de nuevo
          </p>
          <p className="text-xs text-yellow-700">
            WasiAI envía este secret en cada llamada a tu endpoint. Valídalo en tu servidor para asegurarte que la llamada viene de WasiAI.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-yellow-100 px-2 py-1 text-xs font-mono text-yellow-900 break-all">
              {secret}
            </code>
            <button
              onClick={() => { void handleCopy(secret) }}
              className="shrink-0 rounded-lg border border-yellow-300 px-2 py-1 text-xs text-yellow-700 hover:bg-yellow-100"
            >
              {copied ? 'Copiado ✓' : 'Copiar'}
            </button>
          </div>
          <button
            onClick={() => setState('hidden')}
            className="text-xs text-yellow-700 underline"
          >
            Entendido
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
