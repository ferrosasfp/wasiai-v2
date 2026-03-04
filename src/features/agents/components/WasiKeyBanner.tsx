'use client'

/**
 * WasiKeyBanner — WAS-133
 * Muestra banner WasiAI Key a usuarios sin key activa.
 * Copy aprobado en Sprint 20 planning.
 * Se autogestiona: detecta si el usuario tiene key activa y se oculta.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

interface Props {
  locale:       string
  creatorPrice: number // precio base sin gas — para el $X del copy
}

export function WasiKeyBanner({ locale, creatorPrice }: Props) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      // Usuario no autenticado → no mostrar banner (no tiene sentido invitarle a crear key)
      if (!user) return

      fetch('/api/agent-keys')
        .then(r => r.ok ? r.json() as Promise<Array<{ is_active: boolean }>> : [])
        .then((keys) => {
          const hasActive = keys.some((k) => k.is_active)
          setShow(!hasActive)
        })
        .catch(() => setShow(true))
    })
  }, [])

  if (!show) return null

  const isEs    = locale === 'es'
  const priceStr = `$${creatorPrice.toFixed(4)}`

  return (
    <div className="rounded-2xl border border-avax-200 bg-avax-50 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-gray-900">
          {isEs
            ? `Con una WasiAI Key pagas solo ${priceStr}`
            : `With a WasiAI Key you only pay ${priceStr}`}
        </p>
        <p className="text-xs text-gray-600 mt-0.5">
          {isEs
            ? 'Sin gas fee · Deposita una vez · Úsala cuando quieras'
            : 'No gas fee · Deposit once · Use anytime'}
        </p>
      </div>
      <Link
        href={`/${locale}/agent-keys`}
        className="shrink-0 rounded-xl bg-avax-500 px-4 py-2 text-sm font-semibold text-white hover:bg-avax-400 transition text-center"
      >
        {isEs ? 'Crear WasiAI Key →' : 'Create WasiAI Key →'}
      </Link>
    </div>
  )
}
