'use client'

import { useEffect, useState, useCallback } from 'react'
import { useWallet } from '@/features/wallet/hooks/useWallet'
import { RefreshCw, Circle, AlertTriangle, EyeOff, Ban, ChevronDown, ChevronUp, Search } from 'lucide-react'
import Link from 'next/link'

/* ─── Types ─── */
interface HealthCheck {
  passed:      boolean
  latency_ms:  number | null
}

interface Agent {
  id:                    string
  slug:                  string
  name:                  string
  status:                string
  consecutive_failures:  number
  endpoint_domain:       string | null
  creator_id:            string
  creator_username:      string | null
  created_at:            string
  updated_at:            string
  last_checked_at:       string | null
  health_check:          HealthCheck | null
}

interface Summary {
  total:     number
  active:    number
  reviewing: number
  draft:     number
  suspended: number
}

/* ─── Constants ─── */
const OPERATOR_ADDRESS = process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? ''
const OWNER_ADDRESS    = process.env.NEXT_PUBLIC_WASIAI_OWNER ?? ''
const ADMIN_ALLOWED = [
  OPERATOR_ADDRESS,
  OWNER_ADDRESS,
  '0x94DCDb84207724A609B17e4838936832EA59B9eD',
  '0xf432baf1315ccDB23E683B95b03fD54Dd3e447Ba',
].map(a => a.toLowerCase()).filter(Boolean)

/* ─── Helpers ─── */
const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: typeof Circle }> = {
  active:    { label: 'Online',    color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/30', icon: Circle },
  reviewing: { label: 'Reviewing', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30', icon: AlertTriangle },
  draft:     { label: 'Draft',     color: 'text-gray-400',   bg: 'bg-gray-500/10 border-gray-500/30', icon: EyeOff },
  suspended: { label: 'Suspended', color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30', icon: Ban },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  )
}

function timeAgo(date: string | null): string {
  if (!date) return '—'
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/* ─── Main ─── */
export default function AdminAgentsPage() {
  const { address, isConnected } = useWallet()
  const isOwner = isConnected && !!address && ADMIN_ALLOWED.includes(address.toLowerCase())

  const [agents, setAgents]     = useState<Agent[]>([])
  const [summary, setSummary]   = useState<Summary | null>(null)
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState<string>('all')
  const [search, setSearch]     = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [actionMsg, setActionMsg] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/agents')
      if (res.ok) {
        const data = await res.json() as { summary: Summary; agents: Agent[] }
        setSummary(data.summary)
        setAgents(data.agents)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const updateAgent = async (id: string, patch: { status?: string; consecutive_failures?: number }) => {
    setActionMsg(prev => ({ ...prev, [id]: 'Updating…' }))
    try {
      const res = await fetch(`/api/admin/agents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        setActionMsg(prev => ({ ...prev, [id]: '✅' }))
        void load()
      } else {
        const err = await res.json() as { error?: string }
        setActionMsg(prev => ({ ...prev, [id]: `❌ ${err.error ?? 'Failed'}` }))
      }
    } catch (e) {
      setActionMsg(prev => ({ ...prev, [id]: `❌ ${String(e)}` }))
    }
    setTimeout(() => setActionMsg(prev => { const n = { ...prev }; delete n[id]; return n }), 3000)
  }

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /* ─── Filter & Search ─── */
  const filtered = agents.filter(a => {
    if (filter !== 'all' && a.status !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        a.slug.toLowerCase().includes(q) ||
        a.name?.toLowerCase().includes(q) ||
        a.creator_username?.toLowerCase().includes(q) ||
        a.endpoint_domain?.toLowerCase().includes(q)
      )
    }
    return true
  })

  /* ─── Render ─── */
  if (!isConnected) {
    return (
      <div className="mx-auto max-w-6xl p-8">
        <p className="text-gray-400">Connect wallet to access admin panel.</p>
      </div>
    )
  }

  if (!isOwner) {
    return (
      <div className="mx-auto max-w-6xl p-8">
        <div className="rounded-lg border border-red-700 bg-red-950 p-4 text-red-300">
          Access restricted to WasiAI admin wallets.
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl p-8 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-gray-400 hover:text-white text-sm">← Admin</Link>
            <h1 className="text-2xl font-bold text-white">Agent Dashboard</h1>
          </div>
          <p className="text-gray-400 text-sm mt-1">Monitor and manage all marketplace agents</p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-gray-800 border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:text-white hover:border-gray-500 transition"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ── Summary Cards ── */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { key: 'all',       label: 'Total',     count: summary.total,     color: 'text-white',      border: 'border-gray-600' },
            { key: 'active',    label: 'Online',    count: summary.active,    color: 'text-green-400',  border: 'border-green-500/30' },
            { key: 'reviewing', label: 'Reviewing', count: summary.reviewing, color: 'text-yellow-400', border: 'border-yellow-500/30' },
            { key: 'draft',     label: 'Draft',     count: summary.draft,     color: 'text-gray-400',   border: 'border-gray-500/30' },
            { key: 'suspended', label: 'Suspended', count: summary.suspended, color: 'text-red-400',    border: 'border-red-500/30' },
          ].map(c => (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={`rounded-lg border p-4 text-center transition hover:bg-gray-800/50 ${
                filter === c.key ? `${c.border} bg-gray-800/60` : 'border-gray-700/50 bg-gray-900'
              }`}
            >
              <div className={`text-3xl font-bold ${c.color}`}>{c.count}</div>
              <div className="text-xs text-gray-400 mt-1">{c.label}</div>
            </button>
          ))}
        </div>
      )}

      {/* ── Search ── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          placeholder="Search agents by name, slug, creator, or domain…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-lg bg-gray-800 border border-gray-700 pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
        />
      </div>

      {/* ── Agent List ── */}
      {loading && agents.length === 0 ? (
        <div className="text-center py-12 text-gray-400">Loading agents…</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(agent => {
            const hc = agent.health_check
            const isExpanded = expanded.has(agent.id)
            const hasHealthIssue = agent.consecutive_failures > 0

            return (
              <div
                key={agent.id}
                className={`rounded-lg border bg-gray-900 transition ${
                  hasHealthIssue ? 'border-yellow-500/30' : 'border-gray-700/50'
                }`}
              >
                {/* ── Row ── */}
                <button
                  onClick={() => toggleExpand(agent.id)}
                  className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-gray-800/50 transition"
                >
                  {/* Health indicator */}
                  <div className="flex-shrink-0">
                    {hc?.passed ? (
                      <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]" />
                    ) : hc && !hc.passed ? (
                      <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]" />
                    ) : (
                      <div className="w-2.5 h-2.5 rounded-full bg-gray-600" />
                    )}
                  </div>

                  {/* Name & slug */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white truncate">{agent.name ?? agent.slug}</span>
                      <StatusBadge status={agent.status} />
                      {agent.consecutive_failures > 0 && (
                        <span className="text-xs text-red-400 font-mono">
                          cf={agent.consecutive_failures}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {agent.slug} · {agent.endpoint_domain ?? 'no endpoint'} · by {agent.creator_username ?? agent.creator_id?.slice(0, 8)}
                    </div>
                  </div>

                  {/* Health info */}
                  <div className="hidden sm:flex items-center gap-4 text-xs text-gray-400 flex-shrink-0">
                    {hc?.latency_ms != null && (
                      <span className={hc.latency_ms > 3000 ? 'text-yellow-400' : 'text-gray-400'}>
                        {hc.latency_ms}ms
                      </span>
                    )}
                    {false && (
                      <span className={`font-mono ${false ? 'text-red-400' : 'text-green-400'}`}>
                        {null}
                      </span>
                    )}
                    {agent.last_checked_at && (
                      <span>{timeAgo(agent.last_checked_at)}</span>
                    )}
                  </div>

                  {/* Expand icon */}
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  )}
                </button>

                {/* ── Expanded Detail ── */}
                {isExpanded && (
                  <div className="border-t border-gray-700/50 px-4 py-3 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <div>
                        <span className="text-gray-500 text-xs">Status</span>
                        <div className="text-white">{agent.status}</div>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">Consecutive Failures</span>
                        <div className={agent.consecutive_failures > 0 ? 'text-red-400' : 'text-green-400'}>
                          {agent.consecutive_failures}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">Last Check</span>
                        <div className="text-white">{agent.last_checked_at ? new Date(agent.last_checked_at).toLocaleString() : '—'}</div>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">HTTP Status</span>
                        <div className="text-white font-mono">{null ?? '—'}</div>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">Latency</span>
                        <div className="text-white">{hc?.latency_ms != null ? `${hc.latency_ms}ms` : '—'}</div>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">Domain</span>
                        <div className="text-white font-mono text-xs">{agent.endpoint_domain ?? '—'}</div>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">Creator</span>
                        <div className="text-white">{agent.creator_username ?? 'Unknown'}</div>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">Created</span>
                        <div className="text-white">{new Date(agent.created_at).toLocaleDateString()}</div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2 border-t border-gray-700/30">
                      <span className="text-xs text-gray-500 mr-2">Set status:</span>
                      {['active', 'reviewing', 'draft', 'suspended'].map(s => (
                        <button
                          key={s}
                          disabled={agent.status === s}
                          onClick={() => void updateAgent(agent.id, { status: s, consecutive_failures: 0 })}
                          className={`rounded px-3 py-1 text-xs font-medium transition ${
                            agent.status === s
                              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                              : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white border border-gray-600'
                          }`}
                        >
                          {STATUS_CONFIG[s]?.label ?? s}
                        </button>
                      ))}
                      {agent.consecutive_failures > 0 && (
                        <button
                          onClick={() => void updateAgent(agent.id, { consecutive_failures: 0 })}
                          className="rounded px-3 py-1 text-xs font-medium bg-gray-800 text-yellow-400 hover:bg-gray-700 border border-yellow-500/30"
                        >
                          Reset failures
                        </button>
                      )}
                      {actionMsg[agent.id] && (
                        <span className="text-xs text-gray-400 ml-2">{actionMsg[agent.id]}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {filtered.length === 0 && (
            <div className="text-center py-12 text-gray-500">No agents match the current filter.</div>
          )}
        </div>
      )}
    </div>
  )
}
