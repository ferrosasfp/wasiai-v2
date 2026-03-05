'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, X, Search, Upload, Loader2 } from 'lucide-react'

interface Collection {
  id: string
  slug: string
  name: string
  description: string | null
  cover_image: string | null
  featured: boolean
  sort_order: number
  agent_count: number
}

interface CollectionAgent {
  sort_order: number
  agent: { id: string; slug: string; name: string; category: string }
}

interface AgentOption {
  id: string
  slug: string
  name: string
  category: string
}

interface FormData {
  name: string
  slug: string
  description: string
  cover_image: string
  featured: boolean
}

const emptyForm: FormData = { name: '', slug: '', description: '', cover_image: '', featured: false }

export function AdminCollections() {
  const t = useTranslations('admin')
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<FormData>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  // Agent management
  const [collectionAgents, setCollectionAgents] = useState<CollectionAgent[]>([])
  const [allAgents, setAllAgents] = useState<AgentOption[]>([])
  const [agentSearch, setAgentSearch] = useState('')
  const [showAgentDropdown, setShowAgentDropdown] = useState(false)
  const [uploading, setUploading] = useState(false)

  const loadCollections = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/collections')
      if (res.ok) setCollections(await res.json() as Collection[])
    } finally { setLoading(false) }
  }, [])

  const loadAgentsForCollection = useCallback(async (collectionId: string) => {
    const res = await fetch(`/api/admin/collections/${collectionId}/agents`)
    if (res.ok) setCollectionAgents(await res.json() as CollectionAgent[])
  }, [])

  const loadAllAgents = useCallback(async () => {
    const agentsRes = await fetch('/api/v1/agents/discover?limit=50')
    if (agentsRes.ok) {
      const data = await agentsRes.json() as { agents: AgentOption[] }
      setAllAgents(data.agents)
    }
  }, [])

  useEffect(() => { void loadCollections(); void loadAllAgents() }, [loadCollections, loadAllAgents])

  function startCreate() {
    setCreating(true)
    setEditingId(null)
    setForm(emptyForm)
    setCollectionAgents([])
    setMsg('')
  }

  function startEdit(c: Collection) {
    setEditingId(c.id)
    setCreating(false)
    setForm({
      name: c.name,
      slug: c.slug,
      description: c.description ?? '',
      cover_image: c.cover_image ?? '',
      featured: c.featured,
    })
    setMsg('')
    void loadAgentsForCollection(c.id)
  }

  function cancelForm() {
    setCreating(false)
    setEditingId(null)
    setForm(emptyForm)
    setCollectionAgents([])
    setMsg('')
  }

  function handleNameChange(name: string) {
    setForm(f => ({
      ...f,
      name,
      slug: creating ? name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') : f.slug,
    }))
  }

  async function handleSave() {
    setSaving(true)
    setMsg('')
    try {
      const url = '/api/admin/collections'
      const method = creating ? 'POST' : 'PUT'
      const body = creating
        ? { name: form.name, slug: form.slug, description: form.description || undefined, cover_image: form.cover_image || undefined, featured: form.featured }
        : { id: editingId, name: form.name, slug: form.slug, description: form.description || undefined, cover_image: form.cover_image || undefined, featured: form.featured }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        setMsg('✅ Saved')
        cancelForm()
        void loadCollections()
      } else {
        const err = await res.json().catch(() => ({})) as { error?: string }
        setMsg(`❌ ${err.error ?? 'Failed'}`)
      }
    } finally { setSaving(false) }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t('confirmDelete'))) return
    const res = await fetch('/api/admin/collections', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) void loadCollections()
  }

  async function addAgent(agentId: string) {
    if (!editingId) return
    await fetch(`/api/admin/collections/${editingId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId }),
    })
    void loadAgentsForCollection(editingId)
    setShowAgentDropdown(false)
    setAgentSearch('')
  }

  async function removeAgent(agentId: string) {
    if (!editingId) return
    await fetch(`/api/admin/collections/${editingId}/agents`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId }),
    })
    void loadAgentsForCollection(editingId)
  }

  async function moveAgent(index: number, direction: -1 | 1) {
    if (!editingId) return
    const newAgents = [...collectionAgents]
    const swapIdx = index + direction
    if (swapIdx < 0 || swapIdx >= newAgents.length) return

    // Swap sort_orders
    const temp = newAgents[index].sort_order
    newAgents[index] = { ...newAgents[index], sort_order: newAgents[swapIdx].sort_order }
    newAgents[swapIdx] = { ...newAgents[swapIdx], sort_order: temp }
    newAgents.sort((a, b) => a.sort_order - b.sort_order)
    setCollectionAgents(newAgents)

    await fetch(`/api/admin/collections/${editingId}/agents`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agents: newAgents.map(a => ({ agent_id: a.agent.id, sort_order: a.sort_order })),
      }),
    })
  }

  const agentIdsInCollection = new Set(collectionAgents.map(a => a.agent.id))
  const filteredAgents = allAgents.filter(a =>
    !agentIdsInCollection.has(a.id) &&
    (a.name.toLowerCase().includes(agentSearch.toLowerCase()) || a.slug.toLowerCase().includes(agentSearch.toLowerCase()))
  )

  const isEditing = creating || editingId !== null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">{t('collections')}</h2>
          <p className="text-sm text-gray-400">{t('collectionsDesc')}</p>
        </div>
        {!isEditing && (
          <button onClick={startCreate} className="inline-flex items-center gap-1.5 rounded-lg bg-avax-600 px-4 py-2 text-sm font-medium text-white hover:bg-avax-700 transition">
            <Plus size={14} /> {t('newCollection')}
          </button>
        )}
      </div>

      {msg && <p className="text-sm">{msg}</p>}

      {/* Form (create/edit) */}
      {isEditing && (
        <div className="rounded-xl bg-gray-800 p-6 space-y-4">
          <h3 className="text-lg font-semibold">{creating ? t('newCollection') : t('editCollection')}</h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('collectionName')}</label>
              <input value={form.name} onChange={e => handleNameChange(e.target.value)}
                className="w-full rounded-lg bg-gray-700 px-3 py-2 text-sm text-white border border-gray-600 focus:border-avax-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('collectionSlug')}</label>
              <input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                className="w-full rounded-lg bg-gray-700 px-3 py-2 text-sm text-white border border-gray-600 focus:border-avax-500 focus:outline-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('collectionDesc')}</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2}
              className="w-full rounded-lg bg-gray-700 px-3 py-2 text-sm text-white border border-gray-600 focus:border-avax-500 focus:outline-none" />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('collectionCover')}</label>
              <div className="flex items-center gap-3">
                {form.cover_image && (
                  <Image src={form.cover_image} alt="cover" width={80} height={48} className="h-12 w-20 rounded object-cover border border-gray-600" />
                )}
                <label className={`inline-flex items-center gap-1.5 cursor-pointer rounded-lg px-3 py-2 text-sm font-medium transition ${uploading ? 'bg-gray-600 text-gray-400' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                  {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {uploading ? 'Uploading...' : 'Upload image'}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" disabled={uploading}
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      setUploading(true)
                      try {
                        const fd = new FormData()
                        fd.append('file', file)
                        fd.append('bucket', 'collections')
                        const res = await fetch('/api/admin/upload', { method: 'POST', body: fd })
                        if (res.ok) {
                          const data = await res.json() as { url: string }
                          setForm(f => ({ ...f, cover_image: data.url }))
                        } else {
                          const err = await res.json().catch(() => ({})) as { error?: string }
                          setMsg(`❌ Upload: ${err.error ?? 'Failed'}`)
                        }
                      } finally { setUploading(false) }
                    }} />
                </label>
                {form.cover_image && (
                  <button onClick={() => setForm(f => ({ ...f, cover_image: '' }))} className="text-xs text-red-400 hover:text-red-300">Remove</button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" checked={form.featured} onChange={e => setForm(f => ({ ...f, featured: e.target.checked }))}
                className="rounded border-gray-600" />
              <label className="text-sm text-gray-300">{t('collectionFeatured')}</label>
            </div>
          </div>

          {/* Agent Manager (only when editing) */}
          {editingId && (
            <div className="border-t border-gray-700 pt-4 space-y-3">
              <h4 className="text-sm font-semibold text-gray-300">{t('agentsInCollection')}</h4>

              {collectionAgents.length === 0 ? (
                <p className="text-xs text-gray-500">No agents yet</p>
              ) : (
                <div className="space-y-1">
                  {collectionAgents.map((ca, idx) => (
                    <div key={ca.agent.id} className="flex items-center gap-2 rounded-lg bg-gray-700 px-3 py-2">
                      <span className="text-xs text-gray-400 w-6">{idx + 1}.</span>
                      <span className="flex-1 text-sm">{ca.agent.name}</span>
                      <span className="text-xs text-gray-500">{ca.agent.category}</span>
                      <button onClick={() => moveAgent(idx, -1)} disabled={idx === 0} className="p-1 text-gray-400 hover:text-white disabled:opacity-30"><ChevronUp size={14} /></button>
                      <button onClick={() => moveAgent(idx, 1)} disabled={idx === collectionAgents.length - 1} className="p-1 text-gray-400 hover:text-white disabled:opacity-30"><ChevronDown size={14} /></button>
                      <button onClick={() => removeAgent(ca.agent.id)} className="p-1 text-red-400 hover:text-red-300"><X size={14} /></button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Agent */}
              <div className="relative">
                <button onClick={() => setShowAgentDropdown(!showAgentDropdown)}
                  className="inline-flex items-center gap-1 text-sm text-avax-400 hover:text-avax-300">
                  <Plus size={12} /> {t('addAgent')}
                </button>

                {showAgentDropdown && (
                  <div className="absolute z-10 mt-1 w-80 rounded-lg bg-gray-700 border border-gray-600 shadow-xl">
                    <div className="p-2 border-b border-gray-600">
                      <div className="flex items-center gap-2 rounded bg-gray-800 px-2 py-1">
                        <Search size={12} className="text-gray-400" />
                        <input value={agentSearch} onChange={e => setAgentSearch(e.target.value)} placeholder="Search agents..."
                          className="flex-1 bg-transparent text-sm text-white outline-none" autoFocus />
                      </div>
                    </div>
                    <div className="max-h-48 overflow-y-auto p-1">
                      {filteredAgents.length === 0 ? (
                        <p className="p-2 text-xs text-gray-500">No agents available</p>
                      ) : (
                        filteredAgents.slice(0, 15).map(a => (
                          <button key={a.id ?? a.slug} onClick={() => addAgent(a.id)}
                            className="w-full text-left rounded px-2 py-1.5 text-sm hover:bg-gray-600 transition">
                            <span className="text-white">{a.name}</span>
                            <span className="ml-2 text-xs text-gray-400">{a.category}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button onClick={handleSave} disabled={saving || !form.name}
              className="rounded-lg bg-avax-600 px-4 py-2 text-sm font-medium text-white hover:bg-avax-700 disabled:opacity-50 transition">
              {saving ? '...' : t('saveCollection')}
            </button>
            <button onClick={cancelForm} className="rounded-lg bg-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-600 transition">
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {!isEditing && (
        loading ? (
          <p className="text-gray-500 text-sm">Loading...</p>
        ) : collections.length === 0 ? (
          <p className="text-gray-500 text-sm">{t('noCollections')}</p>
        ) : (
          <div className="space-y-2">
            {collections.map(c => (
              <div key={c.id} className="flex items-center gap-4 rounded-xl bg-gray-800 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{c.name}</span>
                    {c.featured && <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-400">★ Featured</span>}
                  </div>
                  <p className="text-xs text-gray-500 truncate">/{c.slug} · {c.agent_count} agents</p>
                </div>
                <button onClick={() => startEdit(c)} className="p-2 text-gray-400 hover:text-white transition"><Pencil size={14} /></button>
                <button onClick={() => handleDelete(c.id)} className="p-2 text-red-400 hover:text-red-300 transition"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
