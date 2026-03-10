'use client'

/**
 * WalletSetup — read-only display of the creator's withdrawal wallet.
 * HU-069: Wallet is always the connected wallet, synced via linkWallet().
 * No manual editing — connect/disconnect wallet to change.
 */

interface Props {
  initialWallet: string | null
  pendingEarnings?: number
}

export function WalletSetup({ initialWallet, pendingEarnings = 0 }: Props) {
  if (!initialWallet) {
    return (
      <div className="mt-2">
        <p className="text-xs text-amber-600">
          ⚠️ Connect your wallet to set your withdrawal address
        </p>
      </div>
    )
  }

  return (
    <div className="mt-1 flex items-center gap-2">
      <p className="text-xs text-gray-400 font-mono truncate max-w-[260px]">
        {initialWallet}
      </p>
      {pendingEarnings > 0 && (
        <span className="text-xs text-amber-500" title="Pending earnings on this wallet">
          💰
        </span>
      )}
    </div>
  )
}
