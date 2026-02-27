# SDD — HU-4.3: Ejemplos Input/Output Curados
**Fase:** S1 (Software Design Document)  
**Agente:** Architect — BMAD v6  
**Fecha:** 2026-02-27  
**Sprint:** 8 | 2026-03-07 → 2026-03-14  
**HU Fuente:** `.nexus/docs/prd/HU-4.3-s0.md`  
**Estado:** SPEC_PENDING

---

## Hallazgos del Codebase (Pre-diseño)

### 🚨 Hallazgo CRÍTICO: Número de migration incorrecto en el PRD

**El PRD indica que la migration se llamaría `017_agent_examples.sql`, pero esto es INCORRECTO.**

Estado real de las migrations en el repositorio:
```
...
017_pipeline_executions.sql        ← YA EXISTE
018_free_trial_creator_control.sql ← YA EXISTE  
019_search_vector_agents.sql       ← YA EXISTE
020_agent_calls_analytics_index.sql← YA EXISTE
```

**El `project-context.md` dice "Próxima: 017" pero está desactualizado.**  
La próxima migration disponible real es: **`021`**

**Nombre correcto de la migration:** `021_agent_examples.sql`

Este hallazgo es bloqueante: si el Dev nombra la migration `017_agent_examples.sql`, Supabase puede rechazarla o ejecutarla en orden incorrecto dependiendo de la configuración de migrations.

### ✅ Otras verificaciones

| Check | Resultado |
|-------|-----------|
| `agents` tabla existe | ✅ migration 006 |
| `creator_profiles` tabla existe | ✅ migration 003 |
| `creator_profiles.id = auth.users.id` | ✅ ADR-013 confirmado |
| Trigger `moddatetime` disponible | ⚠️ No confirmado — usar `NOW()` en handler como fallback |
| Ruta de edición de agente | ⚠️ Debe verificar el Dev: puede ser dashboard principal o ruta separada |
| `src/app/[locale]/models/[slug]/page.tsx` | ✅ Ruta confirmada para ficha pública |
| Drag & drop eliminado del scope | ✅ DT-1 en PRD |

---

## Arquitectura

### Nuevos Archivos

```
supabase/migrations/
└── 021_agent_examples.sql                              ← NÚMERO CORRECTO (no 017)

src/
├── features/
│   ├── creator/components/
│   │   └── AgentExamples.tsx                          ← Editor CRUD creator
│   └── models/components/
│       └── AgentExamplesDisplay.tsx                   ← Accordion público
└── app/api/creator/agents/[id]/examples/
    ├── route.ts                                        ← GET + POST
    └── [exId]/
        └── route.ts                                    ← PATCH + DELETE
```

### Archivos Modificados

```
src/app/[locale]/creator/dashboard/page.tsx (o ruta de edición de agente)
src/app/[locale]/models/[slug]/page.tsx
src/messages/en.json
src/messages/es.json
```

---

## Diseño Detallado

### 1. Migration `021_agent_examples.sql`

```sql
-- supabase/migrations/021_agent_examples.sql
-- IMPORTANTE: Número real = 021 (no 017, que ya está ocupado por pipeline_executions)
-- Historia: HU-4.3 — Ejemplos Input/Output Curados
-- Sprint 8

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

-- Lectura pública (para la ficha del agente)
CREATE POLICY "agent_examples_public_read"
  ON agent_examples FOR SELECT
  USING (true);

-- Solo el creator dueño puede escribir
CREATE POLICY "agent_examples_creator_write"
  ON agent_examples FOR ALL
  USING (creator_id = auth.uid());

-- Índice para listar ejemplos de un agente ordenados
-- (sort_order en el índice para uso futuro; ORDER BY usa created_at en MVP)
CREATE INDEX idx_agent_examples_agent_id
  ON agent_examples(agent_id, sort_order);

-- Índice complementario para ordenar por created_at
CREATE INDEX idx_agent_examples_agent_created
  ON agent_examples(agent_id, created_at ASC);

-- Nota: moddatetime trigger NO se crea aquí porque puede no estar disponible.
-- updated_at se maneja con NOW() en el API handler (PATCH).
```

**Notas sobre el schema:**
- `creator_id` referencia `creator_profiles(id)` que = `auth.users.id` (ADR-013)
- El límite de 5 ejemplos se enforcea en API, no en DB (más flexible)
- `sort_order` existe para uso futuro (DT-EXAMPLES-01), pero MVP ordena por `created_at`
- Sin trigger `moddatetime`: más portable entre planes de Supabase

---

### 2. Tipos TypeScript

```typescript
// src/features/models/types/models.types.ts — agregar:

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

### 3. API Routes

#### `src/app/api/creator/agents/[id]/examples/route.ts`

```typescript
// src/app/api/creator/agents/[id]/examples/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const MAX_EXAMPLES = 5

// GET — listar ejemplos (auth required: solo el creator dueño)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verificar ownership del agente
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

  // Verificar límite de 5 ejemplos
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

  // Validar y parsear body
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { input, output, label } = body as { input?: string; output?: string; label?: string }

  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return NextResponse.json({ error: 'input is required' }, { status: 400 })
  }
  if (!output || typeof output !== 'string' || output.trim().length === 0) {
    return NextResponse.json({ error: 'output is required' }, { status: 400 })
  }
  if (input.trim().length > 500) {
    return NextResponse.json({ error: 'input exceeds 500 chars' }, { status: 400 })
  }
  if (output.trim().length > 1000) {
    return NextResponse.json({ error: 'output exceeds 1000 chars' }, { status: 400 })
  }
  if (label && label.trim().length > 60) {
    return NextResponse.json({ error: 'label exceeds 60 chars' }, { status: 400 })
  }

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

#### `src/app/api/creator/agents/[id]/examples/[exId]/route.ts`

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

  // Verificar ownership via RLS — si no es el creator, el update no afectará filas
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { input, output, label } = body as Partial<{ input: string; output: string; label: string }>

  // Validaciones de chars (solo las que vengan en el body)
  if (input !== undefined && input.trim().length > 500)
    return NextResponse.json({ error: 'input exceeds 500 chars' }, { status: 400 })
  if (output !== undefined && output.trim().length > 1000)
    return NextResponse.json({ error: 'output exceeds 1000 chars' }, { status: 400 })
  if (label !== undefined && label.trim().length > 60)
    return NextResponse.json({ error: 'label exceeds 60 chars' }, { status: 400 })

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input  !== undefined) updates.input  = input.trim()
  if (output !== undefined) updates.output = output.trim()
  if (label  !== undefined) updates.label  = label.trim() || null

  const { data, error } = await supabase
    .from('agent_examples')
    .update(updates)
    .eq('id', exId)
    .eq('agent_id', agentId)
    .eq('creator_id', user.id)   // doble check de ownership (además del RLS)
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
    .eq('creator_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (count === 0) return NextResponse.json({ error: 'Not found or forbidden' }, { status: 404 })

  return NextResponse.json({ success: true })
}
```

---

### 4. `src/features/creator/components/AgentExamples.tsx`

```typescript
// src/features/creator/components/AgentExamples.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import type { AgentExample, AgentExampleCreate } from '@/features/models/types/models.types'

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
  const [form, setForm]             = useState<AgentExampleCreate & { label: string }>({
    label: '', input: '', output: ''
  })
  const [error, setError] = useState<string | null>(null)

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

  if (loading) return <div className="py-4 text-sm text-gray-400">Cargando ejemplos...</div>

  return (
    <div className="space-y-4">
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
            <div className="flex gap-2">
              <button
                onClick={() => handleEdit(ex)}
                className="text-xs text-blue-600 hover:underline"
              >
                Editar
              </button>
              <button
                onClick={() => handleDelete(ex.id)}
                className="text-xs text-red-600 hover:underline"
              >
                Eliminar
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded bg-gray-50 p-2">
              <p className="text-gray-400 mb-1">{t('inputLabel')}</p>
              <p className="font-mono text-gray-700 whitespace-pre-wrap">{ex.input}</p>
            </div>
            <div className="rounded bg-avax-50 p-2">
              <p className="text-avax-400 mb-1">{t('outputLabel')}</p>
              <p className="font-mono text-avax-700 whitespace-pre-wrap">{ex.output}</p>
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
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-avax-500"
          />
          <textarea
            placeholder={`${t('inputLabel')} (máx. 500 chars)`}
            value={form.input}
            onChange={e => setForm(f => ({ ...f, input: e.target.value }))}
            maxLength={500}
            rows={3}
            required
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-avax-500"
          />
          <textarea
            placeholder={`${t('outputLabel')} (máx. 1000 chars)`}
            value={form.output}
            onChange={e => setForm(f => ({ ...f, output: e.target.value }))}
            maxLength={1000}
            rows={4}
            required
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-avax-500"
          />

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-avax-500 px-4 py-2 text-sm font-semibold text-white hover:bg-avax-600 disabled:opacity-50 transition"
            >
              {submitting ? 'Guardando...' : editingId ? 'Guardar cambios' : t('add')}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={() => { setEditingId(null); setForm({ label: '', input: '', output: '' }) }}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}

      {!canAdd && !editingId && (
        <p className="text-xs text-amber-600 font-medium">{t('maxReached')}</p>
      )}
    </div>
  )
}
```

---

### 5. `src/features/models/components/AgentExamplesDisplay.tsx`

```typescript
// src/features/models/components/AgentExamplesDisplay.tsx
// Server Component — no 'use client'

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

  // Si no hay ejemplos → no renderizar la sección (AC-8)
  if (error || !examples || examples.length === 0) return null

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
      <h2 className="mb-4 font-semibold text-gray-900">{t('title')}</h2>
      <div className="space-y-3">
        {examples.map((ex, i) => (
          // Accordion usando <details> nativo — sin JS, sin dependencias
          <details key={ex.id} className="group rounded-xl border border-gray-100 overflow-hidden">
            <summary className="flex cursor-pointer items-center justify-between bg-gray-50 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-100 transition select-none list-none">
              <span>{ex.label || `${t('example')} ${i + 1}`}</span>
              <svg
                className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-90"
                fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </summary>
            <div className="grid grid-cols-1 gap-2 p-4 text-xs sm:grid-cols-2">
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="mb-1.5 font-medium text-gray-400 uppercase tracking-wide text-[10px]">
                  {t('inputLabel')}
                </p>
                <p className="font-mono text-gray-700 whitespace-pre-wrap leading-relaxed">{ex.input}</p>
              </div>
              <div className="rounded-lg bg-avax-50 p-3">
                <p className="mb-1.5 font-medium text-avax-400 uppercase tracking-wide text-[10px]">
                  {t('outputLabel')}
                </p>
                <p className="font-mono text-avax-700 whitespace-pre-wrap leading-relaxed">{ex.output}</p>
              </div>
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}
```

> **Decisión de diseño:** Accordion implementado con `<details>/<summary>` HTML nativo — sin dependencias, sin JS de cliente, accesible por defecto, animación con CSS Tailwind `group-open`.

---

### 6. Integración en `models/[slug]/page.tsx`

```typescript
// Agregar import:
import { AgentExamplesDisplay } from '@/features/models/components/AgentExamplesDisplay'

// En la columna principal (lg:col-span-2), después de "Capabilities":
{/* HU-4.3: Ejemplos Input/Output — solo si el agente tiene ejemplos */}
<AgentExamplesDisplay agentId={model.id} />
```

---

### 7. Integración en el Creator Dashboard

```typescript
// En src/app/[locale]/creator/dashboard/page.tsx (o la ruta de edición por agente)
// El Dev DEBE verificar primero cuál es la ruta de edición de agente individual.
// Si es el dashboard principal (un solo agente seleccionado), agregar ahí.

import { AgentExamples } from '@/features/creator/components/AgentExamples'

// Dentro de la sección de edición del agente (por agentId):
<AgentExamples agentId={agent.id} />
```

---

### 8. Traducciones

```json
// src/messages/es.json
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

```json
// src/messages/en.json
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

## Flujo End-to-End

### Flujo Creator (agregar ejemplo)
```
1. Creator accede a la sección de edición de su agente
   ↓
2. AgentExamples monta y hace GET /api/creator/agents/[id]/examples
   → Handler verifica auth + ownership
   → Retorna lista ordenada por created_at ASC
   ↓
3. Creator rellena input/output/label y hace submit
   → POST /api/creator/agents/[id]/examples
   → Handler verifica auth, ownership, count < 5, validaciones de chars
   → INSERT en agent_examples con creator_id = user.id
   → Retorna ejemplo creado con 201
   ↓
4. AgentExamples refetch y muestra el nuevo ejemplo
```

### Flujo Consumer (ver ejemplos)
```
1. Consumer visita /models/[slug]
   ↓
2. Server render: AgentExamplesDisplay hace SELECT * FROM agent_examples
   WHERE agent_id = ? ORDER BY created_at ASC
   → Si count = 0 → retorna null → sección no aparece (AC-8)
   → Si count > 0 → renderiza accordion
   ↓
3. HTML incluye accordion con <details>/<summary>
   → Consumer hace click → expand sin JS adicional
```

### Flujo de Seguridad (intento de acceso cruzado)
```
1. Atacante hace POST /api/creator/agents/[id_ajeno]/examples
   ↓
2. Handler: auth.getUser() → obtiene user.id del atacante
   → consulta agents WHERE id = agentId AND creator_id = user.id
   → No encuentra registro → retorna 403 Forbidden
   ↓
3. Incluso si bypass al handler, RLS de agent_examples:
   → INSERT WHERE creator_id = auth.uid() → rechaza si no coincide
```

---

## Implementation Readiness Check

| Item | Estado | Acción Dev |
|------|--------|-----------|
| **Número de migration** | 🔴 CRÍTICO | Usar `021_agent_examples.sql`, NO `017_agent_examples.sql` |
| Migrations 017–020 ya existen | ✅ Verificado | Sin acción — solo no usar esos números |
| `agents` tabla y `creator_profiles` tabla | ✅ Confirmadas | Sin acción |
| `moddatetime` trigger | ⚠️ No confirmado | Usar `NOW()` en el PATCH handler para `updated_at` |
| Ruta de edición de agente (dashboard) | ⚠️ Verificar | Dev debe revisar `src/app/[locale]/creator/dashboard/page.tsx` y encontrar dónde editar agente individual |
| RLS en `agent_examples` | ❌ No existe aún | Crear en migration 021 |
| Doble validación (frontend + API) de char limits | ❌ No existe | Implementar en `route.ts` (POST y PATCH) |
| Límite de 5 en API (no DB) | ❌ No existe | Implementar COUNT check en POST |
| Accordion con `<details>` nativo | ✅ Diseñado | Sin dependencias adicionales |
| Traducciones `examples.*` | ❌ Ausentes | Agregar en en.json y es.json |
| `ORDER BY created_at ASC` (no sort_order) | ✅ Diseñado | Respetar en todas las queries |
| `PATCH .../reorder` NO implementar | ✅ Eliminado | No crear este endpoint |

---

## Definition of Done

- [ ] `supabase/migrations/021_agent_examples.sql` aplicada en staging sin errores
- [ ] Nombre de archivo es EXACTAMENTE `021_agent_examples.sql` (no 017)
- [ ] RLS activo: creator no puede editar ejemplos de otro creator (test con 2 cuentas)
- [ ] POST con input > 500 chars → 400 desde el API
- [ ] POST con output > 1000 chars → 400 desde el API
- [ ] POST cuando ya hay 5 ejemplos → 422 desde el API
- [ ] GET lista ejemplos en orden `created_at ASC` en dashboard y ficha pública
- [ ] Ficha pública: accordion visible si hay ejemplos, invisible si no hay
- [ ] `AgentExamples` en creator dashboard: CRUD completo funciona (crear, ver, editar, eliminar)
- [ ] Agente sin ejemplos puede publicarse sin errores (AC-9)
- [ ] `npm run build` sin errores TypeScript
- [ ] Traducciones `examples.*` en `en.json` y `es.json`
- [ ] Sin UI de reordenamiento (botones ↑↓, drag & drop) — no existe en esta HU

---

## Deuda Técnica Registrada

| ID | Descripción | Prioridad |
|----|-------------|-----------|
| DT-EXAMPLES-01 | Reordenamiento manual de ejemplos (drag & drop o botones ↑↓). Usar `sort_order` real en ORDER BY. Requiere UI de dnd-kit y endpoint `PATCH .../reorder`. | P3 — backlog |

---

*Generado por Architect — BMAD v6 — 2026-02-27*  
*Gate requerido: Fer escribe `SPEC_APPROVED` después de leer este documento*
