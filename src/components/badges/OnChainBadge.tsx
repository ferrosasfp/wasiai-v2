import { ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'

/**
 * WAS-160d: On-chain Verified badge.
 * Shows when agent.registration_type === 'on_chain'.
 */
export function OnChainBadge() {
  const t = useTranslations('agent')
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
      <ShieldCheck className="h-3 w-3" />
      {t('badge.onChain')}
    </span>
  )
}
