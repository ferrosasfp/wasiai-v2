# Story — HU-3.3: Free Trial Controlado por Creator

**Epic:** E3 — Free Trial por Agente  
**Sprint:** 5  
**Prioridad:** P1  
**Estimado:** 2 días  
**Estado:** READY_FOR_DEV  
**Generado por:** SM Agent (BMAD v6) — 2026-02-26  

---

## Historia de Usuario

Como **creator de agentes en WasiAI**,  
quiero poder **activar o desactivar el free trial de mi agente** desde mi dashboard,  
para **decidir explícitamente si subsidio invocaciones gratuitas** a potenciales usuarios.

---

## Contexto crítico para el dev

**Problema:** Hoy todos los agentes tienen trial activo sin que el creator lo sepa. La tabla `agent_trials` existe (HU-3.1) con unique constraint `(user_id, agent_id)` y limita a 1 trial por par. HU-3.3 extiende eso: el creator puede activar/desactivar el trial y configurar cuántas veces por usuario (1–10).

**Migrations aplicadas:** 000–017. La próxima es **018**.

**Stack inmutable:** Next.js 14 App Router, Supabase (Postgres+RLS), Tailwind, TypeScript strict, viem v2, next-intl para i18n. Sin `any` explícito.

**Reglas absolutas que aplican aquí:**
- RLS activo en toda tabla nueva/modificada (agents ya tiene RLS)
- Sin hardcodes de IDs/slugs
- trim() en env vars
- `git push origin master master:main` al final

---

## Criterios de Aceptación (verificables)

### AC1 — Migration 018 aplicada
- [ ] Archivo `supabase/migrations/018_free_trial_creator_control.sql` existe
- [ ] Columna `agents.free_trial_enabled BOOLEAN NOT NULL DEFAULT FALSE` creada
- [ ] Columna `agents.free_trial_limit INT NOT NULL DEFAULT 1` creada con CHECK (1–10)
- [ ] Columna `agent_trials.times_used INT NOT NULL DEFAULT 1` creada
- [ ] Índice parcial `idx_agents_free_trial_enabled` creado
- [ ] `SELECT COUNT(*) FROM agents WHERE free_trial_enabled = true` → 0 en estado inicial

### AC2 — PATCH `/api/creator/agents/[slug]` acepta campos nuevos
- [ ] Body `{ free_trial_enabled: true, free_trial_limit: 5 }` → 200 con agent actualizado
- [ ] Body `{ free_trial_limit: 11 }` → 400 con mensaje de validación Zod
- [ ] Body `{ free_trial_limit: 0 }` → 400 con mensaje de validación Zod
- [ ] Request de usuario no dueño → 403 (ownership check existente aplica)
- [ ] Campos existentes (name, description, etc.) siguen funcionando sin cambio

### AC3 — Toggle en dashboard del creator
- [ ] `FreeTrialToggle.tsx` renderizado en la ficha de cada agente en `/creator/dashboard`
- [ ] Estado inicial refleja `free_trial_enabled` de la DB
- [ ] Click en toggle → PATCH inmediato, toast "Free trial activado ✓" o "Free trial desactivado"
- [ ] Input numérico de límite visible **solo** cuando toggle = ON
- [ ] Input respeta min=1, max=10; al salir del campo (blur) → PATCH automático
- [ ] Error de red (fetch falla) → revert optimista del toggle y toast de error

### AC4 — Invoke route verifica free_trial_enabled
- [ ] `POST /api/v1/agents/[slug]/invoke` sin `X-API-Key`, agente con `free_trial_enabled = false` → 402 `{ error: 'payment_required' }`
- [ ] `POST /api/v1/agents/[slug]/invoke` sin `X-API-Key`, agente con `free_trial_enabled = true` → 402 `{ error: 'use_trial_endpoint' }`
- [ ] `POST /api/v1/agents/[slug]/invoke` con `X-API-Key` válida → comportamiento sin cambio (proxy normal)

### AC5 — Trial route verifica free_trial_enabled y respeta free_trial_limit
- [ ] `GET /api/v1/agents/[slug]/trial` cuando `free_trial_enabled = false` → 403 `{ error: 'trial_disabled' }`
- [ ] `POST /api/v1/agents/[slug]/trial` cuando `free_trial_enabled = false` → 403 `{ error: 'trial_disabled' }`
- [ ] `POST /trial` primer uso (times_used = 0) → 200 con output; `agent_trials.times_used` → 1
- [ ] `POST /trial` uso N < free_trial_limit → 200; `times_used` → N
- [ ] `POST /trial` cuando `times_used >= free_trial_limit` → 409 `{ error: 'trial_exhausted', limit: N }`

### AC6 — Página pública del agente
- [ ] Badge "🎁 Free Trial" presente en DOM cuando `free_trial_enabled = true`
- [ ] Badge **ausente del DOM** (no hidden, ausente) cuando `free_trial_enabled = false`
- [ ] `AgentTrialPlayground` renderizado solo cuando `free_trial_enabled = true`
- [ ] `AgentTrialPlayground` **ausente del DOM** cuando `free_trial_enabled = false`

---

## Archivos a crear / modificar

| Acción | Archivo |
|--------|---------|
| **CREAR** | `supabase/migrations/018_free_trial_creator_control.sql` |
| **CREAR** | `src/app/[locale]/creator/dashboard/_components/FreeTrialToggle.tsx` |
| **MODIFICAR** | `src/lib/schemas/model.schema.ts` |
| **MODIFICAR** | `src/app/api/v1/agents/[slug]/invoke/route.ts` |
| **MODIFICAR** | `src/app/api/v1/agents/[slug]/trial/route.ts` |
| **MODIFICAR** | `src/app/[locale]/creator/dashboard/_components/AgentActions.tsx` |
| **MODIFICAR** | `src/app/[locale]/creator/dashboard/page.tsx` |
| **MODIFICAR** | `src/app/[locale]/models/[slug]/page.tsx` |
| **MODIFICAR** | `src/features/models/services/models.service.ts` |
| **VERIFICAR** | `src/app/api/v1/agents/__tests__/trial.test.ts` |

---

## Implementación completa

### 1. Migration SQL 018

**Archivo:** `supabase/migrations/018_free_trial_creator_control.sql`

```sql
-- Migration 018: Free trial controlado por creator (HU-3.3)
-- Agrega free_trial_enabled y free_trial_limit a la tabla agents.
-- Agrega times_used a agent_trials para soportar límites > 1.
-- Default FALSE — ningún agente existente tiene trial ON automáticamente.

-- ── agents: control del creator ──────────────────────────────────────────────

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS free_trial_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS free_trial_limit   INT     NOT NULL DEFAULT 1;

-- Constraint: límite entre 1 y 10
ALTER TABLE agents
  ADD CONSTRAINT agents_free_trial_limit_range
    CHECK (free_trial_limit >= 1 AND free_trial_limit <= 10);

-- Índice parcial: acelera lookup de agentes con trial activo
CREATE INDEX IF NOT EXISTS idx_agents_free_trial_enabled
  ON agents (id)
  WHERE free_trial_enabled = TRUE AND status = 'active';

COMMENT ON COLUMN agents.free_trial_enabled IS
  'Si TRUE el creator permite invocaciones gratuitas a usuarios sin API key con fondos.';
COMMENT ON COLUMN agents.free_trial_limit IS
  'Número máximo de invocaciones gratuitas por usuario para este agente (rango 1-10).';

-- ── agent_trials: contador de usos ───────────────────────────────────────────

ALTER TABLE agent_trials
  ADD COLUMN IF NOT EXISTS times_used INT NOT NULL DEFAULT 1;

COMMENT ON COLUMN agent_trials.times_used IS
  'Cuántas veces este usuario ha usado el trial de este agente. Máx = agents.free_trial_limit.';

-- ── Verificación post-apply ───────────────────────────────────────────────────
-- Ejecutar manualmente para confirmar:
--
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'agents'
--   AND column_name IN ('free_trial_enabled', 'free_trial_limit');
-- → 2 filas
--
-- SELECT COUNT(*) FROM agents WHERE free_trial_enabled = true;
-- → 0 (antes de que ningún creator active el toggle)
```

---

### 2. Schema — `src/lib/schemas/model.schema.ts`

Añadir al final del objeto `createModelSchema`, **después de `status`**:

```typescript
  // HU-3.3: Free trial controlado por creator
  free_trial_enabled: z.boolean().optional().default(false),

  free_trial_limit: z.number()
    .int('Debe ser un número entero')
    .min(1, 'Mínimo 1 invocación gratuita')
    .max(10, 'Máximo 10 invocaciones gratuitas')
    .optional()
    .default(1),
```

El schema parcial usado en PATCH (`createModelSchema.omit({ slug }).partial()`) automáticamente incluirá los dos campos nuevos sin cambio adicional.

---

### 3. Componente nuevo — `FreeTrialToggle.tsx`

**Archivo:** `src/app/[locale]/creator/dashboard/_components/FreeTrialToggle.tsx`

```tsx
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
  const [enabled, setEnabled]            = useState(initialEnabled)
  const [limit, setLimit]                = useState(initialLimit)
  const [toast, setToast]                = useState<string | null>(null)
  const [isPending, startTransition]     = useTransition()

  // Refs para revert optimista
  const prevEnabled = initialEnabled
  const prevLimit   = initialLimit

  async function patch(nextEnabled: boolean, nextLimit: number) {
    const res = await fetch(`/api/creator/agents/${slug}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        free_trial_enabled: nextEnabled,
        free_trial_limit:   nextLimit,
      }),
    })

    if (res.ok) {
      const msg = nextEnabled ? 'Free trial activado ✓' : 'Free trial desactivado'
      setToast(msg)
      setTimeout(() => setToast(null), 3000)
    } else {
      // Revert optimista
      setEnabled(prevEnabled)
      setLimit(prevLimit)
      setToast('Error al guardar. Intenta de nuevo.')
      setTimeout(() => setToast(null), 4000)
    }
  }

  function handleToggle() {
    const next = !enabled
    setEnabled(next) // optimista
    startTransition(() => { patch(next, limit) })
  }

  function handleLimitChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1))
    setLimit(val)
  }

  function handleLimitBlur() {
    if (enabled) {
      startTransition(() => { patch(enabled, limit) })
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 mt-3">
      {/* Header con toggle */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-900">Free Trial</p>
          <p className="text-xs text-gray-500 max-w-xs">
            Permite que usuarios prueben tu agente gratis antes de requerir fondos.
          </p>
        </div>

        {/* Toggle switch accesible */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Activar free trial"
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
            Los usuarios pueden probar tu agente hasta{' '}
            <span className="font-medium text-gray-600">{limit}</span>{' '}
            {limit === 1 ? 'vez' : 'veces'} sin API key con fondos. (min 1, max 10)
          </p>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <p
          className={`text-xs font-medium ${
            toast.includes('Error') ? 'text-red-600' : 'text-green-600'
          }`}
          role="status"
          aria-live="polite"
        >
          {toast}
        </p>
      )}
    </div>
  )
}
```

---

### 4. `AgentActions.tsx` — añadir FreeTrialToggle

**Cambios exactos:**

```tsx
// 1. Añadir import al inicio del archivo:
import { FreeTrialToggle } from './FreeTrialToggle'

// 2. Extender interface:
interface AgentActionsProps {
  slug: string
  locale: string
  currentStatus: string
  agentName: string
  freeTrialEnabled: boolean   // HU-3.3
  freeTrialLimit:   number    // HU-3.3
}

// 3. Extender destructuring:
export function AgentActions({ slug, locale, currentStatus, agentName, freeTrialEnabled, freeTrialLimit }: AgentActionsProps) {

// 4. Añadir al final del return, DESPUÉS del div de botones (antes del cierre del div raíz):
      <FreeTrialToggle
        slug={slug}
        initialEnabled={freeTrialEnabled}
        initialLimit={freeTrialLimit}
      />
```

El componente actual retorna `<div className="flex items-center gap-2">`. Envolver en un fragmento o `<div>` padre para incluir `FreeTrialToggle` debajo:

```tsx
// Cambiar el return de AgentActions a:
  return (
    <div>
      <div className="flex items-center gap-2">
        {/* Edit */}
        <Link ...>✏️ Edit</Link>

        {/* Pause / Resume */}
        {!isDeleted && (
          <button onClick={handleToggleStatus} ...>
            {/* ... */}
          </button>
        )}

        {/* Delete */}
        <button onClick={handleDelete} ...>
          {/* ... */}
        </button>
      </div>

      {/* HU-3.3: Free Trial Toggle */}
      <FreeTrialToggle
        slug={slug}
        initialEnabled={freeTrialEnabled}
        initialLimit={freeTrialLimit}
      />
    </div>
  )
```

---

### 5. `dashboard/page.tsx` — pasar nuevos props

**Cambio 1:** Actualizar interface `ModelRow` (línea ~17):

```typescript
interface ModelRow {
  id: string
  name: string
  slug: string
  category: string
  status: string
  price_per_call: number
  total_calls: number
  total_revenue: number
  created_at: string
  free_trial_enabled: boolean   // HU-3.3
  free_trial_limit:   number    // HU-3.3
}
```

**Cambio 2:** Extender el select de agentes (línea ~63):

```typescript
  const { data: models } = await supabase
    .from('agents')
    .select('id, name, slug, category, status, price_per_call, total_calls, total_revenue, created_at, free_trial_enabled, free_trial_limit')
    .eq('creator_id', user.id)
    .order('total_calls', { ascending: false })
```

**Cambio 3:** Pasar nuevos props al componente `AgentActions` (línea ~181):

```tsx
<AgentActions
  slug={model.slug}
  locale={locale}
  currentStatus={model.status}
  agentName={model.name}
  freeTrialEnabled={model.free_trial_enabled ?? false}
  freeTrialLimit={model.free_trial_limit ?? 1}
/>
```

---

### 6. `invoke/route.ts` — guard HU-3.3

**Archivo:** `src/app/api/v1/agents/[slug]/invoke/route.ts`

**Cambio:** Añadir import y guard ANTES del check de `!apiKey` existente. El handler actual retorna 401 si no hay API key. HU-3.3 requiere retornar 402 con mensajes específicos.

```typescript
// Añadir import al inicio (después de 'next/server'):
import { createServiceClient } from '@/lib/supabase/server'

// Reemplazar el bloque existente:
//   if (!apiKey) {
//     return NextResponse.json({ error: 'unauthorized', ... }, { status: 401 })
//   }
//
// Por este bloque:

  if (!apiKey) {
    // HU-3.3: Verificar si el agente tiene free trial activo antes de responder
    const svc = createServiceClient()
    const { data: agentMeta } = await svc
      .from('agents')
      .select('free_trial_enabled')
      .eq('slug', slug)
      .eq('status', 'active')
      .single()

    if (!agentMeta?.free_trial_enabled) {
      return NextResponse.json(
        {
          error:   'payment_required',
          message: 'Free trial not available for this agent. An API key with funds is required.',
        },
        { status: 402, headers: CORS },
      )
    }

    // Trial disponible — guiar al cliente al endpoint correcto
    return NextResponse.json(
      {
        error:          'use_trial_endpoint',
        message:        'Use POST /api/v1/agents/{slug}/trial for free trial invocations.',
        trial_endpoint: `/api/v1/agents/${slug}/trial`,
      },
      { status: 402, headers: CORS },
    )
  }

  // ... resto del handler sin cambio (proxy a /api/v1/models/[slug]/invoke)
```

---

### 7. `trial/route.ts` — guard + respeta free_trial_limit

**Archivo:** `src/app/api/v1/agents/[slug]/trial/route.ts`

**Cambio en GET** — reemplazar el select del agente y agregar guard:

```typescript
// Cambiar:
//   const { data: agent } = await svc
//     .from('agents')
//     .select('id')
//     ...
//
// Por:

  const { data: agent } = await svc
    .from('agents')
    .select('id, free_trial_enabled, free_trial_limit')   // HU-3.3
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

// Cambiar el select de agent_trials (GET) para reflejar times_used:
  const { data: trial } = await svc
    .from('agent_trials')
    .select('times_used, used_at')   // añadir times_used
    .eq('user_id', user.id)
    .eq('agent_id', agent.id)
    .single()

  const timesUsed      = trial?.times_used ?? 0
  const trialsRemaining = Math.max(0, agent.free_trial_limit - timesUsed)

  return NextResponse.json({
    used:            timesUsed >= agent.free_trial_limit,
    trialsUsed:      timesUsed,
    trialsRemaining,
    limit:           agent.free_trial_limit,
    usedAt:          trial?.used_at ?? null,
  })
```

**Cambio en POST** — reemplazar el select del agente, agregar guards y reemplazar la lógica de registro:

```typescript
// Cambiar select del agente (paso 4):
  const { data: agent } = await svc
    .from('agents')
    .select('id, endpoint_url, name, free_trial_enabled, free_trial_limit')  // HU-3.3
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

// Reemplazar el bloque "Check trial ya usado" (paso 6) por:

  // HU-3.3: Verificar cuántos trials ha usado este usuario para este agente
  const { data: existingTrial } = await svc
    .from('agent_trials')
    .select('id, times_used')
    .eq('user_id', user.id)
    .eq('agent_id', agent.id)
    .single()

  const currentUsed = existingTrial?.times_used ?? 0

  if (currentUsed >= agent.free_trial_limit) {
    return NextResponse.json(
      {
        error:   'trial_exhausted',
        message: `Has usado todas tus ${agent.free_trial_limit} invocaciones gratuitas para este agente.`,
        limit:   agent.free_trial_limit,
      },
      { status: 409 },
    )
  }

// Reemplazar el bloque "Registrar trial" (paso 7) por:

  // HU-3.3: Registrar o incrementar trial
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

  // Pasos 8 en adelante sin cambio (llamada al endpoint, truncate, logTrialCall)
```

---

### 8. `models/[slug]/page.tsx` — badge condicional

**Archivo:** `src/app/[locale]/models/[slug]/page.tsx`

**Cambio 1:** En el header del agente, añadir badge después del badge de `Featured`:

```tsx
{/* Badges — categoría y featured existen. HU-3.3 añade Free Trial */}
<div className="flex flex-wrap items-center gap-2">
  <h1 className="text-2xl font-bold text-gray-900">{model.name}</h1>
  {model.is_featured && (
    <span className="rounded-full bg-avax-50 px-3 py-0.5 text-xs font-semibold text-avax-600">Featured</span>
  )}
  {/* HU-3.3: Badge Free Trial — solo si el creator lo activó */}
  {model.free_trial_enabled && (
    <span className="rounded-full bg-green-50 border border-green-200 px-3 py-0.5 text-xs font-semibold text-green-700">
      🎁 Free Trial
    </span>
  )}
  <span className="rounded-full bg-gray-100 px-3 py-0.5 text-xs font-medium text-gray-600 capitalize">
    {model.category}
  </span>
</div>
```

**Cambio 2:** `AgentTrialPlayground` condicional (actualmente en línea 125, siempre renderizado):

```tsx
{/* HU-3.3: Trial Playground solo si el creator lo activó — ausente del DOM si no */}
{model.free_trial_enabled ? (
  <AgentTrialPlayground slug={model.slug} isAuthenticated={isAuthenticated} />
) : null}
```

---

### 9. `models.service.ts` — incluir campos nuevos en select

**Archivo:** `src/features/models/services/models.service.ts`

El select actual usa `'*'`, por lo que `free_trial_enabled` y `free_trial_limit` **ya se incluyen automáticamente** después de aplicar la migration. No se requiere cambio en el query.

Sin embargo, si el tipo `Model` es explícito (no inferido de Supabase), añadir los campos al tipo en `src/features/models/types/models.types.ts`:

```typescript
// Añadir al tipo Model / AgentRow:
free_trial_enabled: boolean
free_trial_limit:   number
```

Verificar con:
```bash
grep -n "free_trial" src/features/models/types/models.types.ts
```

Si el tipo se genera con `supabase gen types`, regenerar después de aplicar migration:
```bash
npx supabase gen types typescript --project-id bdwvrwzvsldephfibmuu > src/lib/database.types.ts
```

---

### 10. Keys i18n (next-intl)

Revisar si existe `messages/es.json` y `messages/en.json`. Añadir bajo clave `creator.freeTrial`:

**`messages/es.json`**
```json
{
  "creator": {
    "freeTrial": {
      "label": "Free Trial",
      "description": "Permite que usuarios prueben tu agente gratis antes de requerir fondos.",
      "limitLabel": "Invocaciones gratuitas por usuario",
      "limitHint": "Los usuarios pueden probar tu agente hasta {limit} {times} sin API key con fondos. (min 1, max 10)",
      "timesOne": "vez",
      "timesMany": "veces",
      "toastOn": "Free trial activado ✓",
      "toastOff": "Free trial desactivado",
      "toastError": "Error al guardar. Intenta de nuevo."
    }
  },
  "agents": {
    "badge": {
      "freeTrial": "🎁 Free Trial"
    }
  }
}
```

**`messages/en.json`**
```json
{
  "creator": {
    "freeTrial": {
      "label": "Free Trial",
      "description": "Allow users to try your agent for free before requiring funds.",
      "limitLabel": "Free invocations per user",
      "limitHint": "Users can try your agent up to {limit} {times} without a funded API key. (min 1, max 10)",
      "timesOne": "time",
      "timesMany": "times",
      "toastOn": "Free trial enabled ✓",
      "toastOff": "Free trial disabled",
      "toastError": "Failed to save. Please try again."
    }
  },
  "agents": {
    "badge": {
      "freeTrial": "🎁 Free Trial"
    }
  }
}
```

> **Nota:** El componente `FreeTrialToggle.tsx` incluido en este story usa strings hardcoded en español para velocidad de implementación. Si el proyecto usa `useTranslations()` activamente en componentes del creator dashboard, adaptar con `const t = useTranslations('creator.freeTrial')` y reemplazar strings por `t('label')`, etc.

---

## Contrato de errores API nuevos

| Endpoint | Status | `error` | Condición |
|----------|--------|---------|-----------|
| `POST /trial` | 403 | `trial_disabled` | `free_trial_enabled = false` |
| `GET /trial` | 403 | `trial_disabled` | `free_trial_enabled = false` |
| `POST /trial` | 409 | `trial_exhausted` | `times_used >= free_trial_limit` |
| `POST /invoke` (sin key) | 402 | `payment_required` | `free_trial_enabled = false` |
| `POST /invoke` (sin key) | 402 | `use_trial_endpoint` | `free_trial_enabled = true` |
| `PATCH /creator/agents/[slug]` | 400 | Validation error | `free_trial_limit` ∉ [1, 10] |

---

## Definition of Done (DoD) — checklist pre-commit

### DB
- [ ] `018_free_trial_creator_control.sql` aplica sin error en local: `npx supabase db reset`
- [ ] `SELECT COUNT(*) FROM agents WHERE free_trial_enabled = true;` → 0
- [ ] `\d agents` muestra `free_trial_enabled` y `free_trial_limit` con defaults correctos
- [ ] `\d agent_trials` muestra `times_used INT DEFAULT 1`
- [ ] Constraint `agents_free_trial_limit_range` aparece en `\d agents`
- [ ] Índice `idx_agents_free_trial_enabled` visible en `\di agents`

### Schema y tipos
- [ ] `createModelSchema` acepta `free_trial_enabled` y `free_trial_limit`
- [ ] `free_trial_limit: 11` → error Zod "Máximo 10 invocaciones gratuitas"
- [ ] `free_trial_limit: 0` → error Zod "Mínimo 1 invocación gratuita"
- [ ] Tipo `Model` / `AgentRow` incluye ambos campos (no TypeScript errors)

### API PATCH
- [ ] `PATCH /api/creator/agents/[slug]` con `{ free_trial_enabled: true, free_trial_limit: 3 }` → 200
- [ ] `PATCH` con `free_trial_limit: 11` → 400
- [ ] `PATCH` por no-dueño → 403
- [ ] `PATCH` con campos existentes (name) → 200, sin cambio en free_trial_*

### API Trial (GET)
- [ ] `GET /trial` agente con `free_trial_enabled = false` → 403 `trial_disabled`
- [ ] `GET /trial` agente con `free_trial_enabled = true`, sin uso previo → `{ used: false, trialsUsed: 0, trialsRemaining: N, limit: N }`
- [ ] `GET /trial` después de N usos = limit → `{ used: true, trialsUsed: N, trialsRemaining: 0 }`

### API Trial (POST)
- [ ] `POST /trial` agente con `free_trial_enabled = false` → 403 `trial_disabled`
- [ ] `POST /trial` primer uso → 200 con `output`; `agent_trials.times_used = 1`
- [ ] `POST /trial` uso 2 (limit=3) → 200; `times_used = 2`
- [ ] `POST /trial` uso 4 (limit=3) → 409 `trial_exhausted`
- [ ] `logTrialCall` se ejecuta correctamente después de cada invocación exitosa

### API Invoke
- [ ] `POST /invoke` sin `X-API-Key`, `free_trial_enabled = false` → 402 `payment_required`
- [ ] `POST /invoke` sin `X-API-Key`, `free_trial_enabled = true` → 402 `use_trial_endpoint`
- [ ] `POST /invoke` con `X-API-Key` válida → proxy normal sin cambio (200 o el código que retorne el upstream)

### UI Creator
- [ ] `FreeTrialToggle` renderizado en cada agente del dashboard
- [ ] Toggle muestra estado correcto al cargar (refleja DB)
- [ ] Click en toggle → PATCH + toast en ≤ 2s
- [ ] Input numérico solo visible cuando toggle = ON
- [ ] Cambiar input a 5 + blur → PATCH con `free_trial_limit: 5`
- [ ] Simular error de red → toggle revierte, toast de error
- [ ] `TypeScript: npx tsc --noEmit` → 0 errores

### UI Pública
- [ ] `/models/[slug]` con `free_trial_enabled = true` → badge "🎁 Free Trial" en DOM
- [ ] `/models/[slug]` con `free_trial_enabled = false` → badge **ausente** del DOM (inspeccionar elementos)
- [ ] `AgentTrialPlayground` presente en DOM solo cuando `free_trial_enabled = true`
- [ ] `AgentTrialPlayground` **ausente** del DOM cuando `free_trial_enabled = false`

### Sin regresiones
- [ ] Tests existentes `trial.test.ts` pasan (actualizar mocks para incluir `free_trial_enabled: true` en agentes de prueba)
- [ ] Agentes con `free_trial_enabled = false` (todos los existentes pre-migration) NO muestran trial en `/models/[slug]`
- [ ] Lint: `npx eslint src --max-warnings=0`
- [ ] Build: `npx next build` completa sin errores

### Git
- [ ] Commit message: `feat(HU-3.3): free trial controlado por creator — migration 018, toggle UI, invoke guard`
- [ ] Push: `git push origin master master:main`

---

## Notas de implementación para el dev

1. **Orden de implementación recomendado:**
   1. Migration 018 → aplicar y verificar en local
   2. Schema (model.schema.ts) → sin cambios breaking
   3. trial/route.ts → guards primero (GET, luego POST)
   4. invoke/route.ts → guard sin API key
   5. FreeTrialToggle.tsx → componente nuevo
   6. AgentActions.tsx → integrar toggle
   7. dashboard/page.tsx → pasar props nuevos
   8. models/[slug]/page.tsx → badge + condicional AgentTrialPlayground
   9. Tipos TypeScript si hace falta
   10. Tests → actualizar mocks de trial.test.ts

2. **El unique constraint de `agent_trials (user_id, agent_id)` se mantiene** — solo se agrega `times_used`. El upsert existente en el handler de trial DEBE reemplazarse por la lógica `insert/update` descrita en la sección 7.

3. **`free_trial_enabled` ya viene en el select `'*'`** en `models.service.ts` — solo asegurar que el tipo TypeScript lo incluya.

4. **El rate limit de trials (3 req/hora por IP, Upstash)** sigue activo — no se modifica.

5. **`AgentTrialPlayground` renderiza condicionalmente en el server** — el `{model.free_trial_enabled ? <Playground /> : null}` es suficiente; no hace falta `display: none`.

6. **Agentes existentes**: Todos quedarán con `free_trial_enabled = false` tras la migration. Los creators que quieran ofrecer trial deben activarlo manualmente. Esto es intencional (AC1).

---

*Story generado por SM Agent (BMAD v6) — WasiAI Sprint 5 — 2026-02-26*
