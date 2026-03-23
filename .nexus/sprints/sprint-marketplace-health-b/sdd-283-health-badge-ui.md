# SDD WAS-283 — Badge de salud de endpoint en marketplace UI
**Clasificación:** HU-MAJOR
**Archivos:**
- `src/app/api/v1/agents/route.ts` — agregar `health_check` y `last_checked_at` al select
- `src/features/models/types/models.types.ts` — agregar campos al interface Model
- `src/features/models/components/ModelCard.tsx` — renderizar badge
- `src/components/badges/HealthBadge.tsx` — nuevo componente

## Context
Los campos `health_check` y `last_checked_at` existen en DB y son actualizados por WAS-277 (activación) y WAS-281 (cron horario). No se exponen en la API pública ni se renderizan en la UI. Los compradores no pueden saber si un agente está funcionando antes de pagar.

**Decisiones aprobadas por PO:**
- Refresh strategy: **SSR puro** — sin polling cliente
- `performance_score` excluido del scope — no lo actualiza ningún cron actual
- Badge estados: `online` (passed=true), `down` (passed=false + last_checked reciente), `not_checked` (last_checked_at null)
- i18n: OBLIGATORIO — la ruta usa `[locale]`

## Acceptance Criteria
- AC1: WHEN la API `/v1/agents` se llama THEN incluye `health_check` y `last_checked_at` por agente
- AC2: WHEN `health_check.passed === true` THEN el badge muestra 🟢 Online
- AC3: WHEN `health_check.passed === false` THEN el badge muestra 🔴 Down con tooltip "Last checked: X min ago"
- AC4: WHEN `last_checked_at === null` THEN el badge muestra ⚪ Not checked
- AC5: WHEN el locale no es 'en' THEN los textos del badge usan el sistema i18n
- AC6: WHEN el badge se renderiza THEN tiene `aria-label` con el texto del estado (accesibilidad)

## Wave 0 — Pre-flight
- [ ] Leer `src/app/api/v1/agents/route.ts` líneas 200-235 — ver el select actual
- [ ] Leer `src/features/models/types/models.types.ts` — ver interface `Model` y `HealthCheckResult`
- [ ] Leer `src/features/models/components/ModelCard.tsx` — ver estructura del card y cómo usa `model`
- [ ] Verificar que `HealthCheckResult` está exportada desde `health-probe.ts` (WAS-277 la creó)
- [ ] Leer `src/i18n/` o `messages/` — ver estructura de traducciones existentes
- [ ] Build gate: `npx tsc --noEmit 2>&1 | head -20`

## Wave 1 — Exponer health_check en API
**Archivo:** `src/app/api/v1/agents/route.ts`

En el select principal (línea ~203), agregar `health_check` y `last_checked_at`:
```typescript
.select(`
  id, slug, name, description, category,
  agent_type, dependencies,
  price_per_call, currency, chain,
  capabilities, mcp_tool_name, mcp_description,
  input_schema, output_schema, metadata,
  total_calls, total_revenue,
  on_chain_registered, erc8004_id,
  reputation_score, reputation_count,
  sandbox_enabled,
  performance_score,
  health_check,
  last_checked_at,
  is_featured, created_at,
  creator:creator_profiles(
    id, username, display_name, verified, wallet_address
  )
`, { count: 'exact' })
```

También agregar al select del path de búsqueda slim (línea ~158) — este path SÍ existe en el repo. Agregar `health_check, last_checked_at` al `.select(...)` de ese path para que el badge aparezca también en resultados de búsqueda.

En el response mapper (~línea 325), agregar:
```typescript
health_check:    agent.health_check    ?? null,
last_checked_at: agent.last_checked_at ?? null,
```

**Build gate:** `npx tsc --noEmit`

## Wave 2 — Agregar al type Model
**Archivo:** `src/features/models/types/models.types.ts`

```typescript
// WAS-283: health probe fields (updated by WAS-277 on activation, WAS-281 cron)
health_check:    { passed: boolean; reason?: string; message?: string; latency_ms?: number } | null
last_checked_at: string | null
```

**Build gate:** `npx tsc --noEmit`

## Wave 3 — Componente HealthBadge
**Archivo:** `src/components/badges/HealthBadge.tsx` (nuevo, junto a `OnChainBadge.tsx`)

```typescript
'use client'

import { useTranslations } from 'next-intl'

interface HealthBadgeProps {
  healthCheck: { passed: boolean; message?: string } | null
  lastCheckedAt: string | null
}

function getMinutesAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
}

export function HealthBadge({ healthCheck, lastCheckedAt }: HealthBadgeProps) {
  const t = useTranslations('health_badge')

  if (!lastCheckedAt || healthCheck === null) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-gray-400"
        aria-label={t('not_checked')}
        title={t('not_checked')}
      >
        <span aria-hidden>⚪</span>
        <span className="hidden sm:inline">{t('not_checked')}</span>
      </span>
    )
  }

  const minutesAgo = getMinutesAgo(lastCheckedAt)
  const checkedLabel = t('last_checked', { minutes: minutesAgo })

  if (healthCheck.passed) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-green-600"
        aria-label={t('online')}
        title={checkedLabel}
      >
        <span aria-hidden>🟢</span>
        <span className="hidden sm:inline">{t('online')}</span>
      </span>
    )
  }

  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-red-500"
      aria-label={`${t('down')} — ${checkedLabel}`}
      title={checkedLabel}
    >
      <span aria-hidden>🔴</span>
      <span className="hidden sm:inline">{t('down')}</span>
    </span>
  )
}
```

**Build gate:** `npx tsc --noEmit`

## Wave 4 — Integrar en ModelCard
**Archivo:** `src/features/models/components/ModelCard.tsx`

Agregar import:
```typescript
import { HealthBadge } from '@/components/badges/HealthBadge'
```

En el JSX del card, agregar el badge en una posición visible (por ejemplo, junto al precio o en el footer del card):
```typescript
<HealthBadge
  healthCheck={model.health_check ?? null}
  lastCheckedAt={model.last_checked_at ?? null}
/>
```

**Build gate:** `npx tsc --noEmit`

## Wave 5 — Traducciones i18n
**Archivos de mensajes** (buscar en `messages/` o `src/i18n/` — ver estructura existente)

Agregar en `en.json` (y `es.json` si existe):
```json
"health_badge": {
  "online": "Online",
  "down": "Down",
  "not_checked": "Not checked",
  "last_checked": "Last checked {minutes}min ago"
}
```

**Build gate:** `npx tsc --noEmit`

## Rollback
```bash
git revert HEAD  # revert todos los archivos, sin migraciones de DB
```

## Critical Constraints
- PROHIBIDO mostrar `endpoint_url` — ya está excluido del select con comentario HAL-028
- PROHIBIDO client-side polling — SSR puro
- OBLIGATORIO i18n para todos los textos visibles del badge
- OBLIGATORIO `aria-label` en el badge (accesibilidad)
- `performance_score` fuera de scope — no agregarlo al badge
