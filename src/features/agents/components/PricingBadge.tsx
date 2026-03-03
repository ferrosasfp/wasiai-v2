'use client'

/**
 * PricingBadge — WAS-133
 * Muestra precio total estimado (creator price + gas fee Chainlink) en el detail page.
 * Fail-open: si el fetch falla, muestra basePrice sin bloquear nada.
 */

import { useEffect, useState } from 'react'

interface PricingData {
  creatorPrice: number
  gasFee:       number
  totalPrice:   number
}

interface Props {
  slug:      string
  basePrice: number // price_per_call del modelo — fallback si fetch falla
}

export function PricingBadge({ slug, basePrice }: Props) {
  const [data, setData]       = useState<PricingData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/v1/models/${slug}/pricing`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: PricingData | null) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [slug])

  if (loading) {
    return <div className="h-5 w-40 animate-pulse rounded bg-gray-200" />
  }

  // AC2: fail-open — mostrar precio base si fetch falla
  if (!data) {
    return (
      <span className="text-sm text-gray-600">
        ~${basePrice.toFixed(4)} USDC
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm font-semibold text-gray-900">
        ~${data.totalPrice.toFixed(4)} USDC
      </span>
      <span className="text-xs text-gray-500">
        ${data.creatorPrice.toFixed(4)} agente + ${data.gasFee.toFixed(4)} gas
      </span>
    </div>
  )
}
