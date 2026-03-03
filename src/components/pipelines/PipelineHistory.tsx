'use client'

import { Fragment, useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface PipelineHistoryItem {
  id:              string
  status:          string
  steps_completed: number
  total_cost_usdc: number
  created_at:      string
  completed_at:    string | null
}

export interface PipelineHistoryProps {
  userId: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es', {
    day:    '2-digit',
    month:  '2-digit',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  })
}

function statusBadge(status: string): string {
  switch (status) {
    case 'success': return 'bg-green-100 text-green-700'
    case 'failed':  return 'bg-red-100 text-red-700'
    case 'partial': return 'bg-yellow-100 text-yellow-700'
    default:        return 'bg-gray-100 text-gray-600'
  }
}

// ── Componente ────────────────────────────────────────────────────────────────

export function PipelineHistory({ userId }: PipelineHistoryProps) {
  const [items, setItems] = useState<PipelineHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return

    const supabase = createClient()
    // pipeline_executions usa RLS via key_id → key_owner_read policy
    // filtra automáticamente por las keys del usuario autenticado
    supabase
      .from('pipeline_executions')
      .select('id, status, steps_completed, total_cost_usdc, created_at, completed_at')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setItems((data ?? []) as PipelineHistoryItem[])
        setLoading(false)
      })
  }, [userId])

  function toggleExpand(id: string) {
    setExpandedId(prev => (prev === id ? null : id))
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-800">Historial de ejecuciones</h2>

      {loading && (
        <div className="text-sm text-gray-500">Cargando historial...</div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-sm text-gray-400 border border-dashed border-gray-300 rounded-lg p-6 text-center">
          No hay ejecuciones previas.
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Fecha</th>
                <th className="px-4 py-3 text-center">Steps</th>
                <th className="px-4 py-3 text-right">Costo USDC</th>
                <th className="px-4 py-3 text-center">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map(item => (
                <Fragment key={item.id}>
                  <tr
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => toggleExpand(item.id)}
                  >
                    <td className="px-4 py-3 text-gray-700">{formatDate(item.created_at)}</td>
                    <td className="px-4 py-3 text-center tabular-nums">{item.steps_completed}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                      {Number(item.total_cost_usdc).toFixed(6)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge(item.status)}`}>
                        {item.status}
                      </span>
                    </td>
                  </tr>
                  {expandedId === item.id && (
                    <tr className="bg-gray-50">
                      <td colSpan={4} className="px-4 py-3">
                        <div className="text-xs text-gray-500 space-y-1">
                          <div>
                            <span className="font-medium">Pipeline ID: </span>
                            <code className="font-mono text-gray-700">{item.id}</code>
                          </div>
                          {item.completed_at && (
                            <div>
                              <span className="font-medium">Completado: </span>
                              {formatDate(item.completed_at)}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
