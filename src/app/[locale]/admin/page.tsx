'use client'

import { useEffect, useState, useCallback, useReducer } from 'react'
import { useWallet } from '@/features/wallet/hooks/useWallet'
import { useWalletClient } from 'wagmi'
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { WalletConnectButton } from '@/features/payments/components/WalletConnectButton'
import { AdminCollections } from '@/components/admin/AdminCollections'
import { useTranslations } from 'next-intl'

interface TreasuryData {
  total_usdc:            number
  key_balances_usdc:     number
  settled_earnings_usdc: number
  platform_fee_bps:      number
  treasury_address:      string
  treasury_balance_usdc: number
}
interface CreatorRow {
  creator_id:   string
  username:     string
  wallet:       string | null
  total_calls:  number
  pending_usdc: number
  settled_usdc: number
  total_usdc:   number
}

const OPERATOR_ADDRESS = process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? ''
const OWNER_ADDRESS    = process.env.NEXT_PUBLIC_WASIAI_OWNER ?? ''

// Direcciones permitidas para acceder al admin (owner + operator)
const ADMIN_ALLOWED = [
  OPERATOR_ADDRESS,
  OWNER_ADDRESS,
  '0x94DCDb84207724A609B17e4838936832EA59B9eD', // owner testnet
  '0xf432baf1315ccDB23E683B95b03fD54Dd3e447Ba', // operator testnet
].map(a => a.toLowerCase()).filter(Boolean)

interface AdminStatus {
  platformFeeBps:    number
  avaxBalance:       number
  avaxBalanceLow:    boolean
  settlementMode:    'vercel' | 'chainlink'
  lastSettlement:    string | null
  pendingRecordings: number
}

export default function AdminPage() {
  const t = useTranslations('admin')
  const [mounted, markMounted] = useReducer(() => true, false)
  useEffect(markMounted, [markMounted])
  const { address, isConnected } = useWallet()
  const { data: walletClient }    = useWalletClient()
  const [status, setStatus]       = useState<AdminStatus | null>(null)
  const [treasury, setTreasury]   = useState<TreasuryData | null>(null)
  const [creators, setCreators]   = useState<CreatorRow[]>([])
  const [showCreators, setShowCreators] = useState(false)
  const [treasuryLoading, setTreasuryLoading] = useState(false)
  const [loading, setLoading]     = useState(true)
  const [newBps, setNewBps]       = useState<string>('')
  const [feeMsg, setFeeMsg]       = useState<string>('')
  const [settleMsg, setSettleMsg] = useState<string>('')
  const [drainMsg, setDrainMsg]   = useState<string>('')

  const isOwner = isConnected && !!address && ADMIN_ALLOWED.includes(address.toLowerCase())

  async function loadStatus() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/status')
      if (res.ok) setStatus(await res.json() as AdminStatus)
    } finally {
      setLoading(false)
    }
  }

  const loadTreasury = useCallback(async () => {
    setTreasuryLoading(true)
    try {
      const [t, c] = await Promise.all([
        fetch('/api/admin/treasury').then(r => r.ok ? r.json() : null) as Promise<TreasuryData | null>,
        fetch('/api/admin/treasury/creators').then(r => r.ok ? r.json() : []) as Promise<CreatorRow[]>,
      ])
      setTreasury(t)
      setCreators(Array.isArray(c) ? c : [])
    } catch { /* best-effort */ }
    finally { setTreasuryLoading(false) }
  }, [])

  useEffect(() => { void loadStatus(); void loadTreasury() }, [loadTreasury])

  async function signAdminAction(action: string): Promise<{
    signature: string
    nonce: string
    timestamp: string
  } | null> {
    if (!walletClient) return null

    const nonce     = ('0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
    const timestamp = BigInt(Math.floor(Date.now() / 1000))

    const signature = await walletClient.signTypedData({
      domain: {
        name:    'WasiAI Admin',
        version: '1',
        chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113),
      },
      types: {
        AdminAction: [
          { name: 'action',    type: 'string'  },
          { name: 'nonce',     type: 'bytes32' },
          { name: 'timestamp', type: 'uint256' },
        ],
      },
      primaryType: 'AdminAction',
      message: { action, nonce, timestamp },
    })

    return { signature, nonce, timestamp: timestamp.toString() }
  }

  async function handleUpdateFee() {
    if (!isOwner) return
    if (!walletClient) { setFeeMsg('❌ Wallet not ready, try reconnecting'); return }
    setFeeMsg('Signing…')

    const auth = await signAdminAction('setPlatformFee').catch(() => null)
    if (!auth) { setFeeMsg('❌ Signature rejected'); return }

    setFeeMsg('Sending tx…')
    try {
      const res = await fetch('/api/admin/fee', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'X-Admin-Signature': auth.signature,
          'X-Admin-Nonce':     auth.nonce,
          'X-Admin-Timestamp': auth.timestamp,
        },
        body: JSON.stringify({ bps: Number(newBps) }),
      })
      const data = await res.json() as { ok?: boolean; txHash?: string; error?: string }
      if (data.ok) {
        setFeeMsg(`✅ Fee updated — tx: ${data.txHash?.slice(0, 12)}…`)
        void loadStatus()
      } else {
        setFeeMsg(`❌ ${data.error ?? 'Failed'}`)
      }
    } catch (err) {
      setFeeMsg(`❌ ${String(err)}`)
    }
  }

  async function handleToggleMode(mode: 'vercel' | 'chainlink') {
    if (!isOwner) return
    if (!walletClient) { setSettleMsg('❌ Wallet not ready, try reconnecting'); return }
    setSettleMsg('Signing…')

    const auth = await signAdminAction('toggleSettlement').catch(() => null)
    if (!auth) { setSettleMsg('❌ Signature rejected'); return }

    setSettleMsg('Updating…')
    try {
      const res = await fetch('/api/admin/settlement', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'X-Admin-Signature': auth.signature,
          'X-Admin-Nonce':     auth.nonce,
          'X-Admin-Timestamp': auth.timestamp,
        },
        body: JSON.stringify({ action: 'toggle', mode }),
      })
      const data = await res.json() as { ok?: boolean; settlementMode?: string; error?: string }
      if (data.ok) {
        setSettleMsg(`✅ Mode set to ${data.settlementMode}`)
        void loadStatus()
      } else {
        setSettleMsg(`❌ ${data.error ?? 'Failed'}`)
      }
    } catch (err) {
      setSettleMsg(`❌ ${String(err)}`)
    }
  }

  async function handleRunSettlement() {
    if (!isOwner) return
    if (!walletClient) { setSettleMsg('❌ Wallet not ready, try reconnecting'); return }
    setSettleMsg('Signing…')

    const auth = await signAdminAction('runSettlement').catch(() => null)
    if (!auth) { setSettleMsg('❌ Signature rejected'); return }

    setSettleMsg('Running settlement…')
    try {
      const res = await fetch('/api/admin/settlement', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'X-Admin-Signature': auth.signature,
          'X-Admin-Nonce':     auth.nonce,
          'X-Admin-Timestamp': auth.timestamp,
        },
        body: JSON.stringify({ action: 'run' }),
      })
      const data = await res.json() as { ok?: boolean; txHash?: string | null; message?: string; error?: string }
      if (data.ok) {
        setSettleMsg(data.txHash ? `✅ Settled — tx: ${data.txHash.slice(0, 12)}…` : `✅ ${data.message ?? 'Done'}`)
        void loadStatus()
      } else {
        setSettleMsg(`❌ ${data.error ?? 'Failed'}`)
      }
    } catch (err) {
      setSettleMsg(`❌ ${String(err)}`)
    }
  }

  async function handleDrainKeys() {
    setDrainMsg('Conectando wallet…')
    const win = window as typeof window & { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }
    if (!win.ethereum) { setDrainMsg('❌ No se detectó wallet'); return }

    const MARKETPLACE = process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI ?? ''
    if (!MARKETPLACE) { setDrainMsg('❌ Contrato no configurado'); return }

    try {
      const accounts = await win.ethereum.request({ method: 'eth_requestAccounts' }) as string[]
      const from = accounts[0]
      const chainHex = await win.ethereum.request({ method: 'eth_chainId' }) as string
      if (parseInt(chainHex, 16) !== 43113) { setDrainMsg('❌ Cambia a Fuji (chain 43113)'); return }

      const OPERATOR = (process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? '').toLowerCase()
      if (from.toLowerCase() !== OPERATOR) {
        setDrainMsg(`❌ Wallet incorrecta. Conectado: ${from.slice(0,10)}… — necesitas la del operador: ${OPERATOR.slice(0,10)}…`)
        return
      }

      // Keys con balance conocido — obtenidos del contrato
      const KEYS_WITH_BALANCE: Array<{ keyId: `0x${string}`; owner: `0x${string}` }> = [
        { keyId: '0x08bdf88cf88c4bc3f4fdfb73451851d9c6ef858896a01b86d489fd763c51c233', owner: '0xfb652f4506731aC58E51b39DCa4F5ECDcb2C1543' },
      ]

      // Selectors verificados: keccak256("refundKeyToEarnings(bytes32)").slice(0,4)
      const refundSelector     = '0x541f593c'
      // keccak256("withdrawFor(address)").slice(0,4)
      const withdrawForSelector = '0x9eca672c'

      const waitReceipt = async (txHash: string) => {
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 2000))
          const receipt = await win.ethereum!.request({ method: 'eth_getTransactionReceipt', params: [txHash] })
          if (receipt) return
        }
      }

      for (const { keyId, owner } of KEYS_WITH_BALANCE) {
        const refundData   = refundSelector    + keyId.slice(2).padStart(64, '0')
        const withdrawData = withdrawForSelector + owner.slice(2).padStart(64, '0')

        // Solo refund si la key aún tiene balance on-chain
        const keyBalSelector  = '0xdad1df98' // keyBalances(bytes32)
        const keyBalCalldata  = keyBalSelector + keyId.slice(2).padStart(64, '0')
        const keyBalHex = await win.ethereum.request({ method: 'eth_call', params: [{ to: MARKETPLACE, data: keyBalCalldata }, 'latest'] }) as string
        const keyBal = BigInt(keyBalHex)

        if (keyBal > 0n) {
          setDrainMsg(`Procesando refundKeyToEarnings (${Number(keyBal)/1e6} USDC)…`)
          const txRefund = await win.ethereum.request({ method: 'eth_sendTransaction', params: [{ from, to: MARKETPLACE, data: refundData }] }) as string
          setDrainMsg(`Refund enviado, esperando confirmación…`)
          await waitReceipt(txRefund)
        }

        // Solo withdrawFor si el owner tiene earnings
        const earningsSelector = '0x543fd313' // earnings(address)
        const earningsCalldata = earningsSelector + owner.slice(2).padStart(64, '0')
        const earningsHex = await win.ethereum.request({ method: 'eth_call', params: [{ to: MARKETPLACE, data: earningsCalldata }, 'latest'] }) as string
        const earnings = BigInt(earningsHex)

        if (earnings > 0n) {
          setDrainMsg(`Retirando ${Number(earnings)/1e6} USDC a owner…`)
          const txWithdraw = await win.ethereum.request({ method: 'eth_sendTransaction', params: [{ from, to: MARKETPLACE, data: withdrawData }] }) as string
          setDrainMsg(`WithdrawFor enviado, esperando confirmación…`)
          await waitReceipt(txWithdraw)
        }
      }

      setDrainMsg('✅ Contrato limpio — recarga el dashboard')
      setTimeout(() => void loadTreasury(), 4000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (err && typeof err === 'object' && 'message' in err) ? String((err as { message: unknown }).message) : String(err)
      setDrainMsg(`❌ ${msg}`)
    }
  }

  if (!mounted) return <div className="mx-auto max-w-3xl p-8 space-y-8" />

  return (
    <div className="mx-auto max-w-3xl p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">{t('title')}</h1>
        <div className="text-sm text-gray-400">
          {mounted && isConnected ? (
            <span className="flex items-center gap-2">
              <span className="font-mono">{address?.slice(0, 6)}…{address?.slice(-4)}</span>
              {isOwner ? (
                <span className="rounded bg-avax-500 px-2 py-0.5 text-xs text-white">Owner</span>
              ) : (
                <span className="rounded bg-red-700 px-2 py-0.5 text-xs text-white">{t('notAuthorized')}</span>
              )}
            </span>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <p className="text-gray-400 text-sm">{t('connectWallet')}</p>
              <WalletConnectButton locale="en" />
            </div>
          )}
        </div>
      </div>

      {!isOwner && (
        <div className="rounded-lg border border-red-700 bg-red-950 p-4 text-red-300">
          Access restricted to WasiAI operator ({OPERATOR_ADDRESS.slice(0, 6)}…{OPERATOR_ADDRESS.slice(-4)})
        </div>
      )}

      {mounted && loading && <p className="text-gray-400">Loading status…</p>}

      {status && (
        <>
          {/* Platform Fee */}
          <section className="rounded-lg border border-gray-700 bg-gray-900 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-avax-400">{t('platformFee')}</h2>
            <p className="text-gray-300">
              {t('current')} <span className="font-bold text-white">{status.platformFeeBps} bps ({(status.platformFeeBps / 100).toFixed(2)}%)</span>
            </p>
            {isOwner && (
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={0}
                  max={3000}
                  placeholder="bps (0–3000)"
                  value={newBps}
                  onChange={e => setNewBps(e.target.value)}
                  className="w-40 rounded bg-gray-800 border border-gray-600 px-3 py-1.5 text-white placeholder-gray-500 focus:outline-none focus:border-avax-500"
                />
                <button
                  onClick={handleUpdateFee}
                  className="rounded bg-avax-500 px-4 py-1.5 text-sm text-white hover:bg-avax-600 disabled:opacity-50"
                >
                  {t('updateFee')}
                </button>
              </div>
            )}
            {feeMsg && <p className="text-sm text-gray-300">{feeMsg}</p>}
          </section>

          {/* Operational Health */}
          <section className="rounded-lg border border-gray-700 bg-gray-900 p-6 space-y-3">
            <h2 className="text-lg font-semibold text-avax-400">Operational Health</h2>
            <div className="flex items-center gap-3">
              <span className="text-gray-300">Operator AVAX balance:</span>
              <span className={`font-bold ${status.avaxBalanceLow ? 'text-red-400' : 'text-green-400'}`}>
                {status.avaxBalance.toFixed(4)} AVAX
              </span>
              {status.avaxBalanceLow && (
                <span className="rounded bg-red-700 px-2 py-0.5 text-xs text-white animate-pulse">
                  ⚠ LOW BALANCE
                </span>
              )}
            </div>
            <div className="text-gray-300">
              Pending recordings: <span className="font-bold text-white">{status.pendingRecordings}</span>
            </div>
          </section>

          {/* Settlement Batch */}
          <section className="rounded-lg border border-gray-700 bg-gray-900 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-avax-400">Settlement Batch</h2>

            <div className="text-gray-300">
              Current mode:{' '}
              <span className="font-bold text-white uppercase">{status.settlementMode}</span>
            </div>

            {status.lastSettlement && (
              <div className="text-gray-300 text-sm">
                Last settlement: {new Date(status.lastSettlement).toLocaleString()}
              </div>
            )}

            {isOwner && (
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={() => handleToggleMode('vercel')}
                  disabled={status.settlementMode === 'vercel'}
                  className="rounded border border-gray-600 px-4 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-40"
                >
                  Vercel Cron
                </button>
                <button
                  onClick={() => handleToggleMode('chainlink')}
                  disabled={status.settlementMode === 'chainlink'}
                  className="rounded border border-avax-600 px-4 py-1.5 text-sm text-avax-300 hover:bg-avax-900 disabled:opacity-40"
                >
                  Chainlink Automation
                </button>
                <button
                  onClick={handleRunSettlement}
                  className="rounded bg-avax-500 px-4 py-1.5 text-sm text-white hover:bg-avax-600"
                >
                  Run Now
                </button>
              </div>
            )}
            {settleMsg && <p className="text-sm text-gray-300">{settleMsg}</p>}
          </section>

          {/* ── Treasury Dashboard ────────────────────────────────────── */}
          <section className="rounded-xl bg-gray-800 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">💰 Treasury Dashboard</h2>
              <button
                onClick={() => void loadTreasury()}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${treasuryLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {treasury ? (
              <>
                {/* Cards principales */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="rounded-lg bg-gray-700 p-4 text-center">
                    <p className="text-xs text-gray-400 mb-1">Total en contrato</p>
                    <p className="text-2xl font-bold text-white">${(treasury.total_usdc ?? 0).toFixed(2)}</p>
                    <p className="text-xs text-gray-500 mt-1">USDC</p>
                  </div>
                  <div className="rounded-lg bg-blue-900/40 border border-blue-700 p-4 text-center">
                    <p className="text-xs text-blue-300 mb-1">
                      WasiAI ({((treasury.platform_fee_bps ?? 1000) / 100).toFixed(0)}%)
                    </p>
                    <p className="text-2xl font-bold text-blue-200">
                      ${((treasury.total_usdc ?? 0) * (treasury.platform_fee_bps ?? 1000) / 10000).toFixed(2)}
                    </p>
                    <p className="text-xs text-blue-400 mt-1">
                      Treasury: ${(treasury.treasury_balance_usdc ?? 0).toFixed(2)} disponible
                    </p>
                  </div>
                  <div className="rounded-lg bg-green-900/40 border border-green-700 p-4 text-center">
                    <p className="text-xs text-green-300 mb-1">
                      Creators ({(100 - (treasury.platform_fee_bps ?? 1000) / 100).toFixed(0)}%)
                    </p>
                    <p className="text-2xl font-bold text-green-200">
                      ${((treasury.total_usdc ?? 0) * (10000 - (treasury.platform_fee_bps ?? 1000)) / 10000).toFixed(2)}
                    </p>
                    <p className="text-xs text-green-400 mt-1">
                      Settled: ${(treasury.settled_earnings_usdc ?? 0).toFixed(2)}
                    </p>
                  </div>
                </div>

                {/* Key balances info */}
                <p className="text-xs text-gray-500">
                  Key balances depositados: <span className="text-gray-300">${(treasury.key_balances_usdc ?? 0).toFixed(2)} USDC</span>
                  {' · '}Treasury: <code className="text-gray-400 text-xs">{(treasury.treasury_address ?? '').slice(0, 10)}…</code>
                </p>

                {/* Collect fees button */}
                <div className="flex items-center gap-3 rounded-lg bg-gray-700/60 border border-gray-600 p-4">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">Cobrar fees al treasury</p>
                    <p className="text-xs text-gray-400 mt-0.5">Ejecuta el settlement on-chain — transfiere el {((treasury.platform_fee_bps ?? 1000) / 100).toFixed(0)}% directamente al treasury wallet</p>
                  </div>
                  <button
                    onClick={() => { void handleRunSettlement(); void loadTreasury() }}
                    className="rounded-lg bg-avax-500 px-4 py-2 text-sm font-medium text-white hover:bg-avax-600 transition whitespace-nowrap"
                  >
                    {t('settlement')}
                  </button>
                </div>

                {/* Limpiar balances */}
                <div className="flex items-center gap-3 rounded-lg bg-red-950/40 border border-red-800 p-4">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-red-300">{t('cleanBalances')}</p>
                    <p className="text-xs text-red-400 mt-0.5">Devuelve USDC de keys huérfanas a sus owners — deja el contrato en cero. Requiere wallet del operador.</p>
                    {drainMsg && <p className="text-xs text-gray-300 mt-1">{drainMsg}</p>}
                  </div>
                  <button
                    onClick={() => void handleDrainKeys()}
                    className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 transition whitespace-nowrap"
                  >
                    Limpiar
                  </button>
                </div>

                {/* Toggle detalle creators */}
                <button
                  onClick={() => setShowCreators(v => !v)}
                  className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors"
                >
                  {showCreators ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  Ver detalle por creator ({creators.length})
                </button>

                {showCreators && (
                  <div className="overflow-x-auto rounded-lg border border-gray-700">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-700 text-gray-300">
                        <tr>
                          <th className="px-4 py-2 text-left">Creator</th>
                          <th className="px-4 py-2 text-right">Calls</th>
                          <th className="px-4 py-2 text-right">Pendiente (DB)</th>
                          <th className="px-4 py-2 text-right">Settled (on-chain)</th>
                          <th className="px-4 py-2 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-700">
                        {creators.length === 0 ? (
                          <tr><td colSpan={5} className="px-4 py-4 text-center text-gray-500">Sin datos</td></tr>
                        ) : creators.map(c => (
                          <tr key={c.creator_id} className="hover:bg-gray-750 text-gray-200">
                            <td className="px-4 py-2">
                              <div className="font-medium">{c.username ?? 'Unknown'}</div>
                              {c.wallet && <div className="text-xs text-gray-500">{c.wallet.slice(0, 10)}…</div>}
                            </td>
                            <td className="px-4 py-2 text-right">{c.total_calls}</td>
                            <td className="px-4 py-2 text-right text-yellow-400">${c.pending_usdc.toFixed(4)}</td>
                            <td className="px-4 py-2 text-right text-green-400">${c.settled_usdc.toFixed(4)}</td>
                            <td className="px-4 py-2 text-right font-semibold">${c.total_usdc.toFixed(4)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <p className="text-gray-500 text-sm">{treasuryLoading ? 'Cargando datos on-chain…' : 'No disponible'}</p>
            )}
          </section>

          {/* ── Collections Manager ──────────────────────────────────── */}
          <section className="rounded-2xl bg-gray-900 p-6">
            <AdminCollections />
          </section>
        </>
      )}
    </div>
  )
}
