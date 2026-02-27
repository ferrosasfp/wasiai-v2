# S1 — SDD: HU-3.3 Free Trial Controlado por Creator

**Epic:** E3 — Free Trial por Agente  
**HU:** HU-3.3  
**Sprint:** 5  
**Estado:** PENDING_SPEC_APPROVED  
**Autor:** PM Agent (BMAD v6)  
**Fecha:** 2026-02-26  

---

## 1. Resumen de cambios

| Capa | Artefacto | Tipo de cambio |
|------|-----------|----------------|
| DB | Migration 018 | Nueva — 2 columnas en `agents` |
| API | `PATCH /api/creator/agents/[slug]` | Extend — acepta nuevos campos |
| API | `POST /api/v1/agents/[slug]/invoke` | Guard — check `free_trial_enabled` previo a proxy |
| API | `GET/POST /api/v1/agents/[slug]/trial` | Guard — check `free_trial_enabled` antes de procesar |
| Schema | `model.schema.ts` | Extend — nuevos campos en `createModelSchema` |
| UI | `FreeTrialToggle` (nuevo componente) | Nuevo — toggle + input numérico en dashboard creator |
| UI | `AgentActions` (existente) | Extend — renderiza `FreeTrialToggle` |
| UI | `models/[slug]/page.tsx` (existente) | Extend — badge condicional + ocultar botón trial |

---

## 2. Migration SQL 018

**Archivo:** `supabase/migrations/018_free_trial_creator_control.sql`

```sql
-- Migration 018: Free trial controlado por creator (HU-3.3)
-- Agrega free_trial_enabled y free_trial_limit a la tabla agents.
-- Default FALSE — no retroactivo, ningún agente existente tiene trial ON automáticamente.

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS free_trial_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS free_trial_limit   INT     NOT NULL DEFAULT 1;

-- Constraint: límite entre 1 y 10
ALTER TABLE agents
  ADD CONSTRAINT agents_free_trial_limit_range
    CHECK (free_trial_limit >= 1 AND free_trial_limit <= 10);

-- Índice parcial: acelera lookup de agentes con trial activo (paginación marketplace)
CREATE INDEX IF NOT EXISTS idx_agents_free_trial_enabled
  ON agents (id)
  WHERE free_trial_enabled = TRUE AND status = 'active';

-- Comentarios para introspección
COMMENT ON COLUMN agents.free_trial_enabled IS
  'Si TRUE el creator permite invocaciones gratuitas a usuarios que no tienen API key con fondos.';
COMMENT ON COLUMN agents.free_trial_limit IS
  'Número máximo de invocaciones gratuitas que un usuario puede hacer sobre este agente (1-10).';
```

**Verificación post-apply:**
```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'agents'
  AND column_name IN ('free_trial_enabled', 'free_trial_limit');
-- Debe retornar 2 filas con defaults boolean/false e int/1
```

---

## 3. Schema — `model.schema.ts`

Extender `createModelSchema` con los dos campos nuevos. **No rompe** el schema parcial usado en PATCH (ya usa `.partial()`).

```typescript
// Añadir al objeto de createModelSchema — después de `status`:

free_trial_enabled: z.boolean().optional().default(false),

free_trial_limit: z.number()
  .int('Debe ser un número entero')
  .min(1, 'Mínimo 1 invocación')
  .max(10, 'Máximo 10 invocaciones')
  .optional()
  .default(1),
```

---

## 4. API — `PATCH /api/creator/agents/[slug]`

**Archivo:** `src/app/api/creator/agents/[slug]/route.ts`

El PATCH existente ya delega validación a `createModelSchema.omit({ slug }).partial()`, por lo que al extender el schema los campos se aceptan automáticamente. **No se requiere cambio en la lógica del handler**, solo en el schema.

Sin embargo, se debe verificar que el update de `result.data` hacia Supabase incluya los nuevos campos. El handler ya hace:
```typescript
.update({ ...result.data, updated_at: new Date().toISOString() })
```
Esto propagará `free_trial_enabled` y `free_trial_limit` al row cuando el cliente los envíe.

**Contrato de request (diferencial):**
```typescript
// PATCH /api/creator/agents/[slug]
// Body (cualquier subconjunto):
{
  free_trial_enabled?: boolean,   // nuevo
  free_trial_limit?:   number     // nuevo, 1-10
}

// Response (sin cambio):
{ agent: Agent }   // donde Agent ahora incluye los dos campos nuevos
```

**Validaciones activas (via schema):**
- `free_trial_limit` ∈ [1, 10] — error 400 si fuera de rango
- Solo el creator dueño puede modificar (ownership check existente)
- CSRF guard existente aplica
- Nota: si `free_trial_enabled = false`, el valor de `free_trial_limit` se persiste igual (sin limpiar) para no perder la configuración cuando vuelvan a activar

---

## 5. API — `POST /api/v1/agents/[slug]/invoke`

**Archivo:** `src/app/api/v1/agents/[slug]/invoke/route.ts`

Este endpoint es un thin proxy hacia `/api/v1/models/[slug]/invoke` (lógica de API Key). Actualmente **no tiene lógica de trial** — su guard es que el header `X-API-Key` esté presente.

**Cambio requerido:** Antes de proxyar, verificar que si la key no tiene fondos el agente sí tiene trial activo. Pero según la HU-3.3, el invoke con API Key no usa trials — los trials son para usuarios sin key. El invoke **solo requiere** que si no hay API-Key válida con fondos, el sistema no caiga en trial silencioso.

**Interpretación correcta (AC4):** El check de `free_trial_enabled` aplica al flujo trial (`/api/v1/agents/[slug]/trial`), **no** al invoke con API key. El invoke con API key sigue siendo independiente del trial. Sin embargo, el invoke route **ya retorna 401** si no hay API key — por lo que no hay trial silencioso en este path.

**Acción requerida:** Añadir un guard explícito en el invoke para el caso futuro en que se intente auto-trial desde invoke (actualmente no existe, pero el AC4 especifica que se debe consultar `free_trial_enabled` antes de verificar agent_trials).

**Cambio mínimo y preciso para AC4:**

```typescript
// src/app/api/v1/agents/[slug]/invoke/route.ts
// Añadir ANTES del check de apiKey vacío:

import { createServiceClient } from '@/lib/supabase/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const apiKey = request.headers.get('X-API-Key') ?? request.headers.get('x-api-key')

  // HU-3.3: Si no hay API key, el sistema podría caer en flujo trial.
  // Verificar free_trial_enabled antes de proceder.
  if (!apiKey) {
    // Consultar si el agente tiene trial disponible
    const svc = createServiceClient()
    const { data: agentMeta } = await svc
      .from('agents')
      .select('free_trial_enabled')
      .eq('slug', slug)
      .eq('status', 'active')
      .single()

    // Si no hay api key Y el agente no tiene trial activo → 402
    if (!agentMeta?.free_trial_enabled) {
      return NextResponse.json(
        {
          error: 'payment_required',
          message: 'Free trial not available for this agent. An API key with funds is required.',
        },
        { status: 402, headers: CORS },
      )
    }

    // Si trial está activo, redirigir al flujo trial en lugar de continuar invoke
    return NextResponse.json(
      {
        error: 'use_trial_endpoint',
        message: 'Use POST /api/v1/agents/{slug}/trial for free trial invocations.',
        trial_endpoint: `/api/v1/agents/${slug}/trial`,
      },
      { status: 402, headers: CORS },
    )
  }

  // ... resto del handler existente sin cambio
```

> **Nota de diseño:** El invoke con API Key no consulta `free_trial_enabled` porque el trial es una ruta alternativa, no un fallback del invoke. El 402 explícito con `use_trial_endpoint` guía al cliente correctamente.

---

## 6. API — `GET/POST /api/v1/agents/[slug]/trial`

**Archivo:** `src/app/api/v1/agents/[slug]/trial/route.ts`

**Cambio en GET (check trial status):**

```typescript
// Modificar el select del agente para incluir free_trial_enabled y free_trial_limit:

const { data: agent } = await svc
  .from('agents')
  .select('id, free_trial_enabled, free_trial_limit')  // ← añadir campos
  .eq('slug', slug)
  .eq('status', 'active')
  .single()

if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })

// HU-3.3: Guard — si trial desactivado por el creator
if (!agent.free_trial_enabled) {
  return NextResponse.json(
    { error: 'trial_disabled', message: 'Free trial not available for this agent.' },
    { status: 403 },
  )
}

// Contar trials usados (respeta free_trial_limit)
const { count } = await svc
  .from('agent_trials')
  .select('id', { count: 'exact', head: true })
  .eq('user_id', user.id)
  .eq('agent_id', agent.id)

const trialsUsed = count ?? 0
const trialsRemaining = agent.free_trial_limit - trialsUsed

return NextResponse.json({
  used:            trialsUsed >= agent.free_trial_limit,
  trialsUsed,
  trialsRemaining: Math.max(0, trialsRemaining),
  limit:           agent.free_trial_limit,
  usedAt:          trialsUsed > 0 ? /* primera fecha */ null : null,
})
```

**Cambio en POST (usar trial):**

```typescript
// Modificar el select del agente en el POST handler:

const { data: agent } = await svc
  .from('agents')
  .select('id, endpoint_url, name, free_trial_enabled, free_trial_limit')  // ← añadir
  .eq('slug', slug)
  .eq('status', 'active')
  .single()

if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })

// HU-3.3: Guard — creator desactivó el trial
if (!agent.free_trial_enabled) {
  return NextResponse.json(
    { error: 'trial_disabled', message: 'Free trial not available for this agent.' },
    { status: 403 },
  )
}

// Contar trials usados vs límite del creator
const { count: trialsUsed } = await svc
  .from('agent_trials')
  .select('id', { count: 'exact', head: true })
  .eq('user_id', user.id)
  .eq('agent_id', agent.id)

if ((trialsUsed ?? 0) >= agent.free_trial_limit) {
  return NextResponse.json(
    {
      error: 'trial_exhausted',
      message: `Has usado todas tus ${agent.free_trial_limit} invocaciones gratuitas para este agente.`,
      limit: agent.free_trial_limit,
    },
    { status: 409 },
  )
}

// ... resto del handler (registro de trial, llamada al endpoint, log) sin cambio
// El upsert existente con ignoreDuplicates sigue siendo válido para idempotencia
```

> **Cambio en conteo:** La lógica existente usa `.single()` para verificar si existe exactamente 1 trial. Con `free_trial_limit` variable ahora se usa `count` para soportar múltiples trials. El upsert con `ignoreDuplicates` debe cambiar a un `insert` simple si se permiten múltiples rows, o mantener upsert con PK compuesta si se diseña como "1 row con contador". **Decisión de implementación:** Mantener 1 row por `(user_id, agent_id)` y agregar columna `times_used INT DEFAULT 1` — pero esto es cambio de schema adicional. **Alternativa más simple (recomendada):** Insertar 1 row por trial consumido (sin unique constraint rígido), y contar con `count`. Esto requiere remover/relajar el unique constraint de `agent_trials` si existe.

**Verificar constraint existente:**
```sql
-- Revisar si existe unique constraint en agent_trials
SELECT constraint_name FROM information_schema.table_constraints
WHERE table_name = 'agent_trials' AND constraint_type = 'UNIQUE';
```

Si existe `UNIQUE(user_id, agent_id)`, se debe incluir en migration 018:
```sql
-- Si free_trial_limit > 1 es posible, el unique constraint debe relajarse.
-- Opción A (recomendada): Mantener unique pero agregar contador en el row
ALTER TABLE agent_trials ADD COLUMN IF NOT EXISTS times_used INT NOT NULL DEFAULT 1;
-- Y en el POST trial: UPDATE times_used = times_used + 1 WHERE user_id AND agent_id,
-- o INSERT si no existe. Comparar times_used vs free_trial_limit.

-- Opción B: Eliminar unique y contar rows (más simple para lógica, más rows en DB)
-- ALTER TABLE agent_trials DROP CONSTRAINT IF EXISTS agent_trials_user_id_agent_id_key;
```

**Opción A es la correcta** — mantiene el unique constraint, agrega `times_used`, compara contra `free_trial_limit`. La migration 018 debe incluir esto.

**Migration 018 actualizada con agent_trials:**

```sql
-- Añadir al archivo 018_free_trial_creator_control.sql:

ALTER TABLE agent_trials
  ADD COLUMN IF NOT EXISTS times_used INT NOT NULL DEFAULT 1;

-- El unique constraint (user_id, agent_id) se mantiene.
-- times_used se incrementa en cada uso vía PATCH o upsert con update.
```

**POST trial — lógica final con times_used:**

```typescript
// Buscar trial existente
const { data: existingTrial } = await svc
  .from('agent_trials')
  .select('id, times_used')
  .eq('user_id', user.id)
  .eq('agent_id', agent.id)
  .single()

const currentUsed = existingTrial?.times_used ?? 0
if (currentUsed >= agent.free_trial_limit) {
  return NextResponse.json(
    { error: 'trial_exhausted', limit: agent.free_trial_limit },
    { status: 409 },
  )
}

// Registrar o incrementar trial
if (existingTrial) {
  await svc
    .from('agent_trials')
    .update({ times_used: currentUsed + 1 })
    .eq('id', existingTrial.id)
} else {
  await svc
    .from('agent_trials')
    .insert({ user_id: user.id, agent_id: agent.id, times_used: 1 })
}
```

---

## 7. Componente UI — `FreeTrialToggle`

**Archivo nuevo:** `src/app/[locale]/creator/dashboard/_components/FreeTrialToggle.tsx`

```typescript
'use client'

import { useState, useTransition } from 'react'

interface FreeTrialToggleProps {
  slug: string
  initialEnabled: boolean
  initialLimit: number
}

export function FreeTrialToggle({
  slug,
  initialEnabled,
  initialLimit,
}: FreeTrialToggleProps) {
  const [enabled, setEnabled]   = useState(initialEnabled)
  const [limit, setLimit]       = useState(initialLimit)
  const [toast, setToast]       = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function patch(nextEnabled: boolean, nextLimit: number) {
    const res = await fetch(`/api/creator/agents/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        free_trial_enabled: nextEnabled,
        free_trial_limit:   nextLimit,
      }),
    })

    if (res.ok) {
      setToast(nextEnabled ? 'Free trial activado ✓' : 'Free trial desactivado')
      setTimeout(() => setToast(null), 3000)
    } else {
      // Revert optimistic
      setEnabled(enabled)
      setLimit(limit)
      setToast('Error al guardar. Intenta de nuevo.')
      setTimeout(() => setToast(null), 4000)
    }
  }

  function handleToggle() {
    const next = !enabled
    setEnabled(next)          // optimistic
    startTransition(() => {
      patch(next, limit)
    })
  }

  function handleLimitChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1))
    setLimit(val)
  }

  function handleLimitBlur() {
    if (enabled) {
      startTransition(() => {
        patch(enabled, limit)
      })
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      {/* Header con toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-900">Free Trial</p>
          <p className="text-xs text-gray-500">
            Permite que usuarios prueben tu agente gratis antes de requerir fondos.
          </p>
        </div>

        {/* Toggle switch */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={handleToggle}
          disabled={isPending}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-avax-500 focus:ring-offset-2 disabled:opacity-50 ${
            enabled ? 'bg-avax-500' : 'bg-gray-200'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Input de límite — visible solo cuando toggle está ON */}
      {enabled && (
        <div className="space-y-1">
          <label
            htmlFor={`trial-limit-${slug}`}
            className="block text-xs font-medium text-gray-700"
          >
            Invocaciones gratuitas por usuario
          </label>
          <input
            id={`trial-limit-${slug}`}
            type="number"
            min={1}
            max={10}
            value={limit}
            onChange={handleLimitChange}
            onBlur={handleLimitBlur}
            disabled={isPending}
            className="w-24 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-avax-500 focus:outline-none focus:ring-1 focus:ring-avax-500 disabled:opacity-50"
          />
          <p className="text-xs text-gray-400">
            Mínimo 1, máximo 10. Los usuarios pueden probar tu agente hasta {limit}{' '}
            {limit === 1 ? 'vez' : 'veces'} sin API key con fondos.
          </p>
        </div>
      )}

      {/* Toast de confirmación */}
      {toast && (
        <p
          className={`text-xs font-medium ${
            toast.includes('Error') ? 'text-red-600' : 'text-green-600'
          }`}
        >
          {toast}
        </p>
      )}
    </div>
  )
}
```

---

## 8. Integración en `AgentActions`

**Archivo:** `src/app/[locale]/creator/dashboard/_components/AgentActions.tsx`

```typescript
// Añadir a la interface AgentActionsProps:
interface AgentActionsProps {
  slug: string
  locale: string
  currentStatus: string
  agentName: string
  freeTrialEnabled: boolean   // nuevo
  freeTrialLimit:   number    // nuevo
}

// Añadir al JSX, después del botón de Delete:
import { FreeTrialToggle } from './FreeTrialToggle'

// Dentro del return, al final del bloque de botones (o en sección separada debajo):
<div className="mt-3">
  <FreeTrialToggle
    slug={slug}
    initialEnabled={freeTrialEnabled}
    initialLimit={freeTrialLimit}
  />
</div>
```

**En `dashboard/page.tsx`** — pasar los nuevos props al renderizar `AgentActions`:
```typescript
// El query de agentes ya hace select de la tabla agents.
// Añadir free_trial_enabled y free_trial_limit al select, y pasarlos:
<AgentActions
  slug={agent.slug}
  locale={locale}
  currentStatus={agent.status}
  agentName={agent.name}
  freeTrialEnabled={agent.free_trial_enabled ?? false}
  freeTrialLimit={agent.free_trial_limit ?? 1}
/>
```

---

## 9. Badge en ficha pública — `models/[slug]/page.tsx`

**Archivo:** `src/app/[locale]/models/[slug]/page.tsx`

El servicio `getModelBySlug` debe incluir `free_trial_enabled` en el select. Verificar en:
`src/features/models/services/models.service.ts`

**Cambio en el header del agente (donde ya están los badges `Featured` y `category`):**

```tsx
{/* HU-3.3: Badge Free Trial — solo si creator lo activó */}
{model.free_trial_enabled && (
  <span className="rounded-full bg-green-50 border border-green-200 px-3 py-0.5 text-xs font-semibold text-green-700">
    🎁 Free Trial
  </span>
)}
```

**Ocultar botón/sección de trial si `free_trial_enabled = false`:**

```tsx
{/* Sección AgentTrialPlayground — condicional */}
{model.free_trial_enabled ? (
  <AgentTrialPlayground slug={model.slug} isAuthenticated={isAuthenticated} />
) : null}
{/* Nota: ausente del DOM, no solo hidden */}
```

**En `models.service.ts`** — añadir campos al select:
```typescript
// Buscar el select principal de getModelBySlug y añadir:
'free_trial_enabled',
'free_trial_limit',
// Actualizar el tipo de retorno si es un tipo explícito
```

---

## 10. Tipos TypeScript

Si existe un tipo `Agent` explícito (no inferido de Supabase), añadir:

```typescript
// En el tipo Agent / AgentRow:
free_trial_enabled: boolean
free_trial_limit:   number
```

Si los tipos se generan desde Supabase CLI (`supabase gen types`), regenerar después de aplicar la migration.

---

## 11. Flujo completo (happy path)

```
Creator activa toggle en dashboard
  → PATCH /api/creator/agents/[slug] { free_trial_enabled: true, free_trial_limit: 3 }
  → DB: agents.free_trial_enabled = true, agents.free_trial_limit = 3
  → Toast: "Free trial activado ✓"

Usuario visita /models/[slug]
  → Badge "🎁 Free Trial" visible en header
  → AgentTrialPlayground renderizado

Usuario hace trial (1ra vez)
  → POST /api/v1/agents/[slug]/trial { input: "..." }
  → Check: agent.free_trial_enabled = true ✓
  → Check: agent_trials.times_used (0) < free_trial_limit (3) ✓
  → INSERT agent_trials { user_id, agent_id, times_used: 1 }
  → Llamada al endpoint del agente → output devuelto

Usuario hace trial (4ta vez, limit=3)
  → POST /api/v1/agents/[slug]/trial
  → Check: times_used (3) >= free_trial_limit (3)
  → 409 { error: 'trial_exhausted', limit: 3 }

Creator desactiva toggle
  → PATCH /api/creator/agents/[slug] { free_trial_enabled: false }
  → Badge desaparece de ficha pública
  → AgentTrialPlayground ausente del DOM
  → POST /api/v1/agents/[slug]/trial → 403 { error: 'trial_disabled' }
  → POST /api/v1/agents/[slug]/invoke sin apiKey → 402 { error: 'payment_required' }
```

---

## 12. Errores nuevos (contrato de API)

| Endpoint | Status | `error` | Condición |
|----------|--------|---------|-----------|
| `POST /trial` | 403 | `trial_disabled` | `free_trial_enabled = false` |
| `GET /trial` | 403 | `trial_disabled` | `free_trial_enabled = false` |
| `POST /trial` | 409 | `trial_exhausted` | `times_used >= free_trial_limit` |
| `POST /invoke` (sin key) | 402 | `payment_required` | `free_trial_enabled = false` |
| `POST /invoke` (sin key) | 402 | `use_trial_endpoint` | `free_trial_enabled = true` |
| `PATCH /creator/agents/[slug]` | 400 | `Validation failed` | `free_trial_limit` fuera de [1,10] |

---

## 13. Definition of Done (DoD)

### DB
- [ ] `018_free_trial_creator_control.sql` existe y aplica sin error en Supabase local y prod
- [ ] Columnas `free_trial_enabled` (bool, default false) y `free_trial_limit` (int, default 1) en `agents`
- [ ] Columna `times_used` (int, default 1) en `agent_trials`
- [ ] Constraint CHECK `free_trial_limit BETWEEN 1 AND 10` activo
- [ ] Índice parcial `idx_agents_free_trial_enabled` creado
- [ ] Agentes existentes tienen `free_trial_enabled = false` (verificado con `SELECT COUNT(*) FROM agents WHERE free_trial_enabled = true` → 0 antes de que creator active)

### Schema
- [ ] `createModelSchema` acepta `free_trial_enabled` y `free_trial_limit` con validaciones correctas
- [ ] `model.schema.ts` no tiene cambios breaking para campos existentes

### API Creator PATCH
- [ ] `PATCH /api/creator/agents/[slug]` con `{ free_trial_enabled: true, free_trial_limit: 5 }` → 200 con agent actualizado
- [ ] `PATCH` con `free_trial_limit: 11` → 400 con mensaje de error de validación
- [ ] `PATCH` por usuario que no es dueño → 403

### API Trial
- [ ] `POST /trial` cuando `free_trial_enabled = false` → 403 `trial_disabled`
- [ ] `GET /trial` cuando `free_trial_enabled = false` → 403 `trial_disabled`
- [ ] `POST /trial` primer uso → 200 con output
- [ ] `POST /trial` al agotar el límite → 409 `trial_exhausted`
- [ ] `times_used` se incrementa correctamente en `agent_trials`

### API Invoke
- [ ] `POST /invoke` sin `X-API-Key` y `free_trial_enabled = false` → 402 `payment_required`
- [ ] `POST /invoke` sin `X-API-Key` y `free_trial_enabled = true` → 402 `use_trial_endpoint`
- [ ] `POST /invoke` con `X-API-Key` válida → comportamiento sin cambio

### UI Creator
- [ ] Toggle visible en el dashboard del creator para cada agente
- [ ] Estado inicial del toggle refleja `free_trial_enabled` de la DB
- [ ] Al activar toggle: PATCH disparado, toast "Free trial activado ✓"
- [ ] Al desactivar toggle: PATCH disparado, toast "Free trial desactivado"
- [ ] Input numérico de límite visible solo cuando toggle = ON
- [ ] Input respeta min=1, max=10
- [ ] Al cambiar el límite y salir del input (blur): PATCH disparado
- [ ] Error de red revierte estado optimista

### UI Pública
- [ ] Badge "🎁 Free Trial" visible en header de ficha cuando `free_trial_enabled = true`
- [ ] Badge **ausente** del DOM cuando `free_trial_enabled = false`
- [ ] `AgentTrialPlayground` renderizado solo cuando `free_trial_enabled = true`
- [ ] `AgentTrialPlayground` **ausente del DOM** (no solo hidden) cuando `false`

### Sin regresiones
- [ ] Tests existentes en `trial.test.ts` pasan (o se actualizan para reflejar nuevo comportamiento)
- [ ] Agentes con `free_trial_enabled = false` (todos los existentes) no muestran trial en UI pública
- [ ] `PATCH /api/creator/agents/[slug]` para campos existentes (name, description, etc.) sigue funcionando

---

## 14. Archivos a crear/modificar

| Acción | Archivo |
|--------|---------|
| CREAR | `supabase/migrations/018_free_trial_creator_control.sql` |
| CREAR | `src/app/[locale]/creator/dashboard/_components/FreeTrialToggle.tsx` |
| MODIFICAR | `src/lib/schemas/model.schema.ts` |
| MODIFICAR | `src/app/api/v1/agents/[slug]/invoke/route.ts` |
| MODIFICAR | `src/app/api/v1/agents/[slug]/trial/route.ts` |
| MODIFICAR | `src/app/[locale]/creator/dashboard/_components/AgentActions.tsx` |
| MODIFICAR | `src/app/[locale]/creator/dashboard/page.tsx` |
| MODIFICAR | `src/app/[locale]/models/[slug]/page.tsx` |
| MODIFICAR | `src/features/models/services/models.service.ts` |
| VERIFICAR | Tests en `src/app/api/v1/agents/__tests__/trial.test.ts` |

---

**Estado:** PENDING_SPEC_APPROVED  
**Requiere aprobación explícita de Fer antes de pasar a Story (SM).**
