'use client'

interface FallbackApproveFlowProps {
  amountUsdc:   number
  approveState: 'idle' | 'approving' | 'done'
  txHash?:      `0x${string}`
  onConfirm:    () => void
  onCancel:     () => void
}

export function FallbackApproveFlow({
  amountUsdc,
  approveState,
  txHash,
  onConfirm,
  onCancel,
}: FallbackApproveFlowProps) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <span className="text-lg">⚠️</span>
        <p className="text-sm font-semibold text-amber-900">
          Aprobación requerida
        </p>
      </div>

      <p className="text-sm text-amber-800">
        Para completar el pago, necesitas aprobar el uso de USDC. No tiene costo adicional.
      </p>

      {approveState === 'idle' && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            onClick={onCancel}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 transition"
          >
            Aprobar {amountUsdc} USDC →
          </button>
        </div>
      )}

      {approveState === 'approving' && (
        <div className="flex items-center gap-2 text-sm text-amber-800">
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Esperando confirmación en tu wallet...</span>
        </div>
      )}

      {approveState === 'done' && (
        <div className="space-y-1 text-sm text-green-700">
          <p>✓ Aprobación confirmada. Reintentando pago automáticamente...</p>
          {txHash && (
            <a
              href={`https://testnet.snowtrace.io/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-avax-500 hover:underline"
            >
              Ver tx ↗
            </a>
          )}
        </div>
      )}
    </div>
  )
}
