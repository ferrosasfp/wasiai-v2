// src/features/models/components/ReputationBadge.tsx
// HU-4.4: Badge compacto de uptime — Server Component (sin 'use client')
// AC-7: Mostrado solo en ModelCard (solo uptime %, color semántico)
// AC-9: Server Component — no hace fetch en cliente

import { getAgentReputation } from '@/lib/reputation'

interface ReputationBadgeProps {
  agentId: string
}

export async function ReputationBadge({ agentId }: ReputationBadgeProps) {
  const rep = await getAgentReputation(agentId)

  // Sin datos suficientes → no renderizar (no contaminar la card)
  if (!rep.hasData || !rep.sufficientData || rep.uptimePct === null) {
    return null
  }

  // AC-6: Color semántico: verde ≥ 99%, amarillo 95-98.9%, rojo < 95%
  const badgeClass =
    rep.uptimePct >= 99 ? 'bg-green-100 text-green-700' :
    rep.uptimePct >= 95 ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
      ↑ {rep.uptimePct.toFixed(1)}%
    </span>
  )
}
