# Story — HU-4.3: Ejemplos Input/Output Curados
**Sprint:** 8 | 2026-03-07 → 2026-03-14
**Prioridad:** P2
**Estimación:** M — 4-6 horas
**Autor:** SM (Bob) — BMAD v6 — 2026-02-27

> **⚠️ Este archivo es 100% autocontenido. El Dev NO necesita leer ningún otro documento.**

---

## Historia de Usuario

> Como creator con un agente publicado en WasiAI, quiero poder agregar hasta 5 ejemplos reales de input/output a mi agente, para que los consumers vean exactamente qué hace mi agente antes de gastar su free trial.

---

## Acceptance Criteria

| # | Criterio | Cómo verificar |
|---|----------|---------------|
| **AC-1** | En el área de edición del agente en el creator dashboard, existe una sección "Ejemplos de uso" donde el creator puede ver, agregar, editar y eliminar ejemplos. | Screenshot del creator dashboard con la sección visible |
| **AC-2** | Cada ejemplo tiene: campo **Input** (textarea, máx 500 chars), campo **Output esperado** (textarea, máx 1000 chars), campo **Etiqueta** opcional (input text, máx 60 chars). Los límites se validan en frontend Y en el API (no solo en frontend). | Test: POST a la API con input de 501 chars → debe rechazar con 400 |
| **AC-3** | El máximo de ejemplos por agente es 5. Si el creator ya tiene 5, el botón "Agregar ejemplo" se deshabilita y aparece el mensaje "Máximo 5 ejemplos por agente". | Test: crear 5 ejemplos, verificar que el botón se deshabilita |
| **AC-4** | Los ejemplos se muestran en orden de creación (`created_at ASC`) tanto en el dashboard del creator como en la ficha pública. No hay UI de reordenamiento (sin botones ↑↓, sin drag & drop). | Screenshot: verificar que no hay controles de orden en la UI |
| **AC-5** | Los ejemplos se almacenan en `agent_examples` con RLS activo. Solo el creator dueño puede crear/editar/eliminar sus propios ejemplos. | Intentar editar ejemplo de otro creator vía API → debe retornar 403 |
| **AC-6** | La política RLS valida que `creator_id = auth.uid()`. El API handler también verifica que el `agent_id` pertenece al creator autenticado (doble validación). | Test: POST a `/api/creator/agents/[id_ajeno]/examples` → 403 |
| **AC-7** | En la ficha pública del agente (`/models/[slug]`), si hay ejemplos, se muestran en un **accordion** nativo (`<details>/<summary>`): cada fila muestra la etiqueta (o "Ejemplo N" si no hay etiqueta), expandible para ver Input y Output. | Screenshot de ficha pública con accordion expandido |
| **AC-8** | Si el agente no tiene ejemplos, la sección "Ejemplos" **no aparece** en la ficha pública. Sin empty state, sin placeholder. | Test con agente sin ejemplos: la sección es invisible |
| **AC-9** | Los ejemplos son opcionales para publicar. El agente puede existir y estar activo sin ningún ejemplo. | Verificar que el flujo de publicación no tiene validación de "al menos 1 ejemplo" |
| **AC-10** | La migration se llama exactamente **`021_agent_examples.sql`**. | `ls supabase/migrations/ \| grep agent_examples` → debe mostrar `021_agent_examples.sql` |
| **AC-11** | La tabla tiene índices en `(agent_id, sort_order)` y `(agent_id, created_at ASC)`. | Revisar migration: `CREATE INDEX idx_agent_examples_agent_id ...` |
| **AC-12** | Traducciones en `es` y `en`: `examples.title`, `examples.add`, `examples.inputLabel`, `examples.outputLabel`, `examples.tagLabel`, `examples.maxReached`, `examples.example`, `examples.noExamples` | `grep -r "examples\." src/messages/` |

---

## 🚨 Hallazgo Crítico del Architect: NÚMERO DE MIGRATION

**EL PRD TIENE UN ERROR. El número `017` está OCUPADO.**

Estado real del repositorio:
```
017_pipeline_executions.sql          ← YA EXISTE
018_free_trial_creator_control.sql   ← YA EXISTE
019_search_vector_agents.sql         ← YA EXISTE
020_agent_calls_analytics_index.sql  ← YA EXISTE
```

**La próxima migration disponible es: `021`**

**Nombre CORRECTO:** `021_agent_examples.sql`

Si el Dev nombra la migration `017_agent_examples.sql`, Supabase puede rechazarla o ejecutarla en orden incorrecto. Este error es bloqueante.

---

## Estructura de Archivos

### CREAR
| Archivo | Descripción |
|---------|-------------|
| `supabase/migrations/021_agent_examples.sql` | Tabla + RLS + índices (ver schema completo abajo) |
| `src/features/creator/components/AgentExamples.tsx` | Editor CRUD (`'use client'`) para el creator |
| `src/features/models/components/AgentExamplesDisplay.tsx` | Accordion público. Server Component. |
| `src/app/api/creator/agents/[id]/examples/route.ts` | GET + POST |
| `src/app/api/creator/agents/[id]/examples/[exId]/route.ts` | PATCH + DELETE |

### MODIFICAR
| Archivo | Cambio |
|---------|--------|
| `src/app/[locale]/creator/dashboard/page.tsx` (o ruta de edición) | Incluir `<AgentExamples agentId={agent.id} />`. **El Dev debe verificar primero cuál es la ruta real de edición de agente individual.** |
| `src/app/[locale]/models/[slug]/page.tsx` | Incluir `<AgentExamplesDisplay agentId={agent.id} />` solo si hay ejemplos |
| `src/messages/es.json` | Agregar `examples.*` |
| `src/messages/en.json` | Agregar `examples.*` |

### NO TOCAR
| Archivo/Recurso | Razón |
|-----------------|-------|
| Tabla `agents` | Sin columnas nuevas |
| API de invocación de agentes | Fuera de scope |
| Contratos Solidity | Fuera de scope |
| Endpoint `PATCH .../reorder` | NO implementar — deuda técnica DT-EXAMPLES-01 |

---

## Tipos e Interfaces

```typescript
// Agregar a src/features/models/types/models.types.ts (o crear si no existe)

export interface AgentExample {
  id: string
  agent_id: string
  creator_id: string
  label: string | null
  input: string
  output: string
  sort_order: number
  created_at: string
  updated_at: string
}

export type AgentExampleCreate = {
  label?: string | null
  input: string
  output: string
}

export type AgentExampleUpdate = Partial<AgentExampleCreate>
```

---

## Schema de la Tabla (migration completa)

```sql
-- supabase/migrations/021_agent_examples.sql
-- ⚠️ NÚMERO CRÍTICO: 021 (NO 017 — ese número ya está ocupado)
-- Historia: HU-4.3 — Ejemplos Input/Output Curados — Sprint 8

CREATE TABLE agent_examples (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  creator_id  UUID        NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  label       TEXT        CHECK (char_length(label) <= 60),
  input       TEXT        NOT NULL CHECK (char_length(input) <= 500),
  output      TEXT        NOT NULL CHECK (char_length(output) <= 1000),
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE agent_examples ENABLE ROW LEVEL SECURITY;

-- Lectura pública (para la ficha del agente en /models/[slug])
CREATE POLICY "agent_examples_public_read"
  ON agent_examples FOR SELECT
  USING (true);

-- Solo el creator dueño puede escribir (INSERT, UPDATE, DELETE)
CREATE POLICY "agent_examples_creator_write"
  ON agent_examples FOR ALL
  USING (creator_id = auth.uid());

-- Índice primario: ordenar ejemplos de un agente
CREATE INDEX idx_agent_examples_agent_id
  ON agent_examples(agent_id, sort_order);

-- Índice secundario: ordenar por fecha de creación (usado en MVP)
CREATE INDEX idx_agent_examples_agent_created
  ON agent_examples(agent_id, created_at ASC);

-- NOTA: NO crear trigger moddatetime — puede no estar disponible en todos los planes.
-- updated_at se actualiza con NOW() explícito en el PATCH handler.
```

**Notas sobre el schema:**
- `creator_profiles.id = auth.users.id` (ADR-013). La FK a `creator_profiles(id)` es correcta.
- El límite de 5 ejemplos se enforcea en el API layer (POST verifica `COUNT(*) < 5`), no en la DB.
- `sort_order` existe para uso futuro (deuda técnica DT-EXAMPLES-01). En MVP siempre es 0.
- `ON DELETE CASCADE` en `agent_id`: si el agente se elimina, sus ejemplos también se eliminan. Comportamiento correcto.

---

## Código de Referencia

### `src/app/api/creator/agents/[id]/examples/route.ts`

```typescript
// src/app/api/creator/agents/[id]/examples/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const MAX_EXAMPLES = 5

// GET — listar ejemplos del agente (solo el creator dueño)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verificar ownership: el agente debe pertenecer al creator autenticado
  const { data: agent } = await supabase
    .from('agents')
    .select('id')
    .eq('id', agentId)
    .eq('creator_id', user.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('agent_examples')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: true })  // AC-4: orden de creación

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ examples: data })
}

// POST — crear ejemplo
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verificar ownership
  const { data: agent } = await supabase
    .from('agents')
    .select('id')
    .eq('id', agentId)
    .eq('creator_id', user.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Verificar límite de 5 ejemplos (enforced en API, no en DB)
  const { count } = await supabase
    .from('agent_examples')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', agentId)

  if ((count ?? 0) >= MAX_EXAMPLES) {
    return NextResponse.json(
      { error: 'Maximum 5 examples per agent' },
      { status: 422 }
    )
  }

  // Parsear y validar body
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { input, output, label } = body as { input?: string; output?: string; label?: string }

  if (!input || typeof input !== 'string' || input.trim().length === 0)
    return NextResponse.json({ error: 'input is required' }, { status: 400 })
  if (!output || typeof output !== 'string' || output.trim().length === 0)
    return NextResponse.json({ error: 'output is required' }, { status: 400 })
  if (input.trim().length > 500)
    return NextResponse.json({ error: 'input exceeds 500 chars' }, { status: 400 })
  if (output.trim().length > 1000)
    return NextResponse.json({ error: 'output exceeds 1000 chars' }, { status: 400 })
  if (label && label.trim().length > 60)
    return NextResponse.json({ error: 'label exceeds 60 chars' }, { status: 400 })

  const { data, error } = await supabase
    .from('agent_examples')
    .insert({
      agent_id:   agentId,
      creator_id: user.id,
      input:      input.trim(),
      output:     output.trim(),
      label:      label?.trim() ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ example: data }, { status: 201 })
}
```

### `src/app/api/creator/agents/[id]/examples/[exId]/route.ts`

```typescript
// src/app/api/creator/agents/[id]/examples/[exId]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// PATCH — editar ejemplo
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; exId: string }> }
) {
  const { id: agentId, exId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { input, output, label } = body as Partial<{ input: string; output: string; label: string }>

  // Validaciones de chars (solo las que vengan en el body)
  if (input  !== undefined && input.trim().length  > 500)
    return NextResponse.json({ error: 'input exceeds 500 chars' }, { status: 400 })
  if (output !== undefined && output.trim().length > 1000)
    return NextResponse.json({ error: 'output exceeds 1000 chars' }, { status: 400 })
  if (label  !== undefined && label.trim().length  > 60)
    return NextResponse.json({ error: 'label exceeds 60 chars' }, { status: 400 })

  // Construir objeto de actualización
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString()  // manual porque no hay trigger moddatetime
  }
  if (input  !== undefined) updates.input  = input.trim()
  if (output !== undefined) updates.output = output.trim()
  if (label  !== undefined) updates.label  = label.trim() || null

  const { data, error } = await supabase
    .from('agent_examples')
    .update(updates)
    .eq('id', exId)
    .eq('agent_id', agentId)
    .eq('creator_id', user.id)   // doble check de ownership + RLS
    .select()
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: 'Not found or forbidden' }, { status: 404 })
  return NextResponse.json({ example: data })
}

// DELETE — eliminar ejemplo
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; exId: string }> }
) {
  const { id: agentId, exId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error, count } = await supabase
    .from('agent_examples')
    .delete({ count: 'exact' })
    .eq('id', exId)
    .eq('agent_id', agentId)
    .eq('creator_id', user.id)  // doble check de ownership + RLS

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (count === 0) return NextResponse.json({ error: 'Not found or forbidden' }, { status: 404 })
  return NextResponse.json({ success: true })
}
```

---

### `src/features/creator/components/AgentExamples.tsx`

```typescript
// src/features/creator/components/AgentExamples.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import type { AgentExample } from '@/features/models/types/models.types'

interface AgentExamplesProps {
  agentId: string
}

const MAX_EXAMPLES = 5

export function AgentExamples({ agentId }: AgentExamplesProps) {
  const t = useTranslations('examples')
  const [examples, setExamples]     = useState<AgentExample[]>([])
  const [loading, setLoading]       = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [form, setForm]             = useState({ label: '', input: '', output: '' })
  const [error, setError]           = useState<string | null>(null)

  const fetchExamples = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/creator/agents/${agentId}/examples`)
    if (res.ok) {
      const { examples } = await res.json()
      setExamples(examples)
    }
    setLoading(false)
  }, [agentId])

  useEffect(() => { fetchExamples() }, [fetchExamples])

  const canAdd = examples.length < MAX_EXAMPLES

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const method = editingId ? 'PATCH' : 'POST'
    const url    = editingId
      ? `/api/creator/agents/${agentId}/examples/${editingId}`
      : `/api/creator/agents/${agentId}/examples`

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    if (!res.ok) {
      const { error: msg } = await res.json()
      setError(msg ?? 'Error desconocido')
    } else {
      setForm({ label: '', input: '', output: '' })
      setEditingId(null)
      await fetchExamples()
    }
    setSubmitting(false)
  }

  async function handleDelete(exId: string) {
    if (!confirm('¿Eliminar este ejemplo?')) return
    await fetch(`/api/creator/agents/${agentId}/examples/${exId}`, { method: 'DELETE' })
    await fetchExamples()
  }

  function handleEdit(ex: AgentExample) {
    setEditingId(ex.id)
    setForm({ label: ex.label ?? '', input: ex.input, output: ex.output })
  }

  function handleCancelEdit() {
    setEditingId(null)
    setForm({ label: '', input: '', output: '' })
    setError(null)
  }

  if (loading) {
    return <div className="py-4 text-sm text-gray-400">Cargando ejemplos...</div>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">{t('title')}</h3>
        <span className="text-xs text-gray-400">{examples.length}/{MAX_EXAMPLES}</span>
      </div>

      {/* Lista de ejemplos existentes */}
      {examples.map((ex, i) => (
        <div key={ex.id} className="rounded-xl border border-gray-200 p-4 text-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-gray-700">
              {ex.label || `${t('example')} ${i + 1}`}
            </span>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => handleEdit(ex)}
                className="text-xs text-blue-600 hover:underline"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => handleDelete(ex.id)}
                className="text-xs text-red-600 hover:underline"
              >
                Eliminar
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded bg-gray-50 p-2">
              <p className="text-gray-400 mb-1 font-medium">{t('inputLabel')}</p>
              <p className="font-mono text-gray-700 whitespace-pre-wrap">{ex.input}</p>
            </div>
            <div className="rounded bg-green-50 p-2">
              <p className="text-green-600 mb-1 font-medium">{t('outputLabel')}</p>
              <p className="font-mono text-green-800 whitespace-pre-wrap">{ex.output}</p>
            </div>
          </div>
        </div>
      ))}

      {/* Formulario agregar / editar */}
      {(canAdd || editingId) && (
        <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-dashed border-gray-300 p-4">
          <h4 className="text-sm font-medium text-gray-700">
            {editingId ? 'Editando ejemplo' : t('add')}
          </h4>

          <input
            type="text"
            placeholder={t('tagLabel')}
            value={form.label}
            onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
            maxLength={60}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <div>
            <label className="block text-xs text-gray-500 mb-1">
              {t('inputLabel')} <span className="text-gray-400">(máx. 500 chars)</span>
            </label>
            <textarea
              value={form.input}
              onChange={e => setForm(f => ({ ...f, input: e.target.value }))}
              maxLength={500}
              rows={3}
              required
              placeholder="Ej: Analiza el sentimiento del siguiente texto: ..."
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-right text-[10px] text-gray-400">{form.input.length}/500</p>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">
              {t('outputLabel')} <span className="text-gray-400">(máx. 1000 chars)</span>
            </label>
            <textarea
              value={form.output}
              onChange={e => setForm(f => ({ ...f, output: e.target.value }))}
              maxLength={1000}
              rows={4}
              required
              placeholder="Ej: { sentiment: 'positive', score: 0.92, ... }"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-right text-[10px] text-gray-400">{form.output.length}/1000</p>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {submitting ? 'Guardando...' : editingId ? 'Guardar cambios' : t('add')}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={handleCancelEdit}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}

      {/* Mensaje límite alcanzado */}
      {!canAdd && !editingId && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 font-medium">
          {t('maxReached')}
        </p>
      )}
    </div>
  )
}
```

---

### `src/features/models/components/AgentExamplesDisplay.tsx`

```typescript
// src/features/models/components/AgentExamplesDisplay.tsx
// Server Component — SIN 'use client'
// Accordion con <details>/<summary> nativo — sin JS de cliente, sin dependencias

import { getTranslations } from 'next-intl/server'
import { createServiceClient } from '@/lib/supabase/server'

interface AgentExamplesDisplayProps {
  agentId: string
}

export async function AgentExamplesDisplay({ agentId }: AgentExamplesDisplayProps) {
  const supabase = createServiceClient()
  const t = await getTranslations('examples')

  const { data: examples, error } = await supabase
    .from('agent_examples')
    .select('id, label, input, output, created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: true })  // AC-4: orden de creación

  // AC-8: si no hay ejemplos → sección invisible (retornar null, no empty state)
  if (error || !examples || examples.length === 0) return null

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
      <h2 className="mb-4 font-semibold text-gray-900">{t('title')}</h2>
      <div className="space-y-2">
        {examples.map((ex, i) => (
          // <details>/<summary> nativo: accordion sin JS, accesible por defecto
          <details key={ex.id} className="group rounded-xl border border-gray-100 overflow-hidden">
            <summary className="flex cursor-pointer items-center justify-between bg-gray-50 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-100 transition select-none list-none">
              <span>{ex.label || `${t('example')} ${i + 1}`}</span>
              {/* Icono chevron que rota al abrir */}
              <svg
                className="h-4 w-4 text-gray-400 transition-transform duration-200 group-open:rotate-90"
                fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </summary>
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  {t('inputLabel')}
                </p>
                <p className="text-xs font-mono text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {ex.input}
                </p>
              </div>
              <div className="rounded-lg bg-green-50 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-green-500">
                  {t('outputLabel')}
                </p>
                <p className="text-xs font-mono text-green-800 whitespace-pre-wrap leading-relaxed">
                  {ex.output}
                </p>
              </div>
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}
```

---

### Integración en `models/[slug]/page.tsx`

```typescript
// Agregar import:
import { AgentExamplesDisplay } from '@/features/models/components/AgentExamplesDisplay'

// En la columna de contenido principal, después de la descripción del agente:
{/* HU-4.3: Ejemplos Input/Output — invisible si no hay ejemplos (component retorna null) */}
<AgentExamplesDisplay agentId={model.id} />
```

---

### Integración en el Creator Dashboard

> **El Dev debe verificar primero** cuál es la ruta real de edición de agente individual. Puede ser:
> - `src/app/[locale]/creator/dashboard/page.tsx` (si hay un agente seleccionado en el dashboard)
> - `src/app/[locale]/creator/agents/[id]/edit/page.tsx` (si existe una ruta separada)
> 
> Si no existe una vista de edición por agente, incluir `<AgentExamples>` en el dashboard principal.

```typescript
// En la ruta verificada de edición del agente:
import { AgentExamples } from '@/features/creator/components/AgentExamples'

// Dentro de la sección de edición del agente:
<AgentExamples agentId={agent.id} />
```

---

### Traducciones

**`src/messages/es.json`** — agregar al objeto raíz:
```json
"examples": {
  "title": "Ejemplos de uso",
  "add": "Agregar ejemplo",
  "inputLabel": "Input",
  "outputLabel": "Output esperado",
  "tagLabel": "Etiqueta (opcional)",
  "maxReached": "Máximo 5 ejemplos por agente",
  "example": "Ejemplo",
  "noExamples": "Sin ejemplos aún"
}
```

**`src/messages/en.json`** — agregar al objeto raíz:
```json
"examples": {
  "title": "Usage examples",
  "add": "Add example",
  "inputLabel": "Input",
  "outputLabel": "Expected output",
  "tagLabel": "Label (optional)",
  "maxReached": "Maximum 5 examples per agent",
  "example": "Example",
  "noExamples": "No examples yet"
}
```

---

## Notas de Implementación

### PRIMER paso: aplicar la migration en staging
Antes de implementar cualquier componente, ejecutar `supabase db push` (o aplicar la migration manualmente en el SQL editor) en staging. Sin la tabla `agent_examples`, el componente `AgentExamplesDisplay` fallará en runtime.

```bash
# Verificar que la migration se llamó correctamente:
ls supabase/migrations/ | grep examples
# Debe mostrar: 021_agent_examples.sql
```

### ¿Por qué el límite de 5 en el API y no en la DB?
Una constraint `CHECK` en la DB sería difícil de manejar (requeriría un trigger o subquery). El API layer con `COUNT(*) < 5` es más simple, más legible y más fácil de cambiar en el futuro si el límite sube.

### ¿Por qué `<details>/<summary>` para el accordion?
- Sin dependencias adicionales (cero npm packages)
- Accesible por defecto (keyboard navigation funciona)
- Sin JS de cliente necesario
- La animación del icono chevron con `group-open:rotate-90` es CSS puro de Tailwind

### ¿Por qué no hay trigger `moddatetime`?
El trigger puede no estar disponible en todos los planes de Supabase. Para ser portables, `updated_at` se actualiza explícitamente con `NOW()` en el handler PATCH. Más simple y más seguro.

### Seguridad: doble validación de ownership
1. **RLS:** `creator_id = auth.uid()` — enforced por Supabase automáticamente
2. **API handler:** verifica que `agents.creator_id = user.id` antes de operar

La doble validación protege contra edge cases donde el RLS podría ser temporalmente deshabilitado por error de configuración.

---

## Deuda Técnica Registrada

| ID | Descripción | Prioridad |
|----|-------------|-----------|
| DT-EXAMPLES-01 | Reordenamiento manual de ejemplos (drag & drop o botones ↑↓). Usar `sort_order` real en ORDER BY. Requiere UI con `@dnd-kit` y endpoint `PATCH .../reorder`. | P3 — backlog |

---

## DoD Checklist

- [ ] `supabase/migrations/021_agent_examples.sql` aplicada en staging sin errores
- [ ] Nombre de archivo es EXACTAMENTE `021_agent_examples.sql` (verificar con `ls`)
- [ ] RLS activo y funcionando: creator no puede editar/eliminar ejemplos de otro creator
- [ ] Test de seguridad: POST a `/api/creator/agents/[id_ajeno]/examples` → 403
- [ ] POST con input > 500 chars → 400 desde el API (no solo frontend)
- [ ] POST con output > 1000 chars → 400 desde el API
- [ ] POST cuando ya hay 5 ejemplos → 422 desde el API
- [ ] GET y listado en UI: ejemplos en orden `created_at ASC`
- [ ] CRUD completo funciona en el dashboard: crear, ver, editar, eliminar
- [ ] Ficha pública `/models/[slug]`: accordion visible si hay ejemplos, invisible si no hay
- [ ] Agente sin ejemplos puede publicarse sin errores
- [ ] Sin UI de reordenamiento (botones ↑↓, drag & drop) — no existe en esta HU
- [ ] Traducciones `examples.*` en `en.json` y `es.json`
- [ ] Tipos `AgentExample`, `AgentExampleCreate`, `AgentExampleUpdate` definidos
- [ ] `npm run build` sin errores TypeScript

---

*Story generado por SM (Bob) — BMAD v6 — Sprint 8 — 2026-02-27*
*Basado en: HU-4.3-s0.md (PRD) + sdd-HU-4.3.md (SDD)*
*Corrección crítica del Architect incluida: migration `021_agent_examples.sql` (NO 017 — ese número está ocupado)*
