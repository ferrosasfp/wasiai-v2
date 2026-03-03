/**
 * EscrowInfoBanner — WAS-72
 *
 * Shown on model detail pages when agent.long_running = true.
 * Informs the user that payment is held in escrow until task completes.
 */
export function EscrowInfoBanner() {
  return (
    <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 flex items-start gap-3">
      <span className="text-xl" aria-hidden="true">⏳</span>
      <div>
        <p className="text-sm font-semibold text-yellow-800">
          Agente de tarea larga
        </p>
        <p className="text-sm text-yellow-700 mt-0.5">
          Este agente puede tardar hasta 24 horas. Tu pago queda protegido en escrow
          y se libera automáticamente al completar. Si algo falla, recibes un reembolso.
        </p>
      </div>
    </div>
  )
}
