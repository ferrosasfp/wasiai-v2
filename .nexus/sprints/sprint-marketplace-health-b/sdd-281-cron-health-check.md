# SDD WAS-281 — Cron de health check periódico para agentes activos
**Clasificación:** HU-MAJOR
**Archivos:**
- `src/app/api/cron/health-check-agents/route.ts` — nuevo
- `vercel.json` — agregar schedule
- `supabase/migrations/NNN_add_consecutive_failures.sql` — nueva columna

## Context
`probeEndpointSync` ahora existe (WAS-277). No hay ningún cron que verifique endpoints post-publicación. Los campos `last_checked_at` y `health_check` se actualizan solo en activación, no periódicamente.

**Decisiones aprobadas por PO:**
- Status en fallo acumulado: `reviewing` (no nuevo enum `degraded`)
- Frecuencia: cada hora — `0 * * * *`
- Contador de fallos: columna `consecutive_failures INT DEFAULT 0` en tabla `agents`
- Reactivación automática: si `consecutive_failures` regresa a 0 tras probe exitoso y el agente estaba en `reviewing` por esta causa → vuelve a `active`

## Acceptance Criteria
- AC1: WHEN el cron corre THEN verifica todos los agentes con `status: active` o `status: reviewing` (para reactivar) en batches de 10
- AC2: WHEN un agente pasa el probe THEN `consecutive_failures` se resetea a 0, `last_checked_at` y `health_check` se actualizan, si estaba `reviewing` vuelve a `active`
- AC3: WHEN un agente falla el probe THEN `consecutive_failures` se incrementa en 1
- AC4: IF `consecutive_failures >= 3` THEN `status` cambia a `reviewing`
- AC5: WHEN el agente no tiene `endpoint_url` THEN se salta sin error
- AC6: WHEN el cron recibe request sin `CRON_SECRET` THEN responde 401
- AC7: WHEN el cron termina THEN responde JSON con `{ checked, passed, failed, reactivated }`

## Wave 0 — Pre-flight
- [ ] `cat vercel.json` — confirmar formato de crons existentes
- [ ] `cat src/app/api/cron/reconcile-onchain/route.ts` — ver patrón de cron (auth, runtime, maxDuration)
- [ ] `grep -r "probeEndpointSync" src/ --include="*.ts"` — confirmar que está exportada desde WAS-277
- [ ] Buscar el número de migration más reciente: `ls supabase/migrations/ | sort | tail -3`
- [ ] Build gate: `cd /home/ferdev/.openclaw/workspace/wasiai-v2 && npx tsc --noEmit 2>&1 | head -20`

## Wave 1 — Migration: columna consecutive_failures
**Archivo:** `supabase/migrations/NNN_add_consecutive_failures.sql`
(usar el número siguiente al último migration existente)

```sql
-- WAS-281: contador de fallos consecutivos de health probe
ALTER TABLE agents ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0;

-- Índice para que el cron filtre eficientemente agentes con fallos
CREATE INDEX IF NOT EXISTS agents_consecutive_failures_idx ON agents (consecutive_failures) WHERE consecutive_failures > 0;
```

**Build gate:** `npx tsc --noEmit` (no afecta TypeScript directamente, pero confirmar que no hay errores previos)

## Wave 2 — Cron route
**Archivo:** `src/app/api/cron/health-check-agents/route.ts`

```typescript
/**
 * GET /api/cron/health-check-agents
 *
 * WAS-281: Periodic health probe for all active agents.
 * Runs every hour. Updates consecutive_failures, health_check, last_checked_at.
 * Marks agents as reviewing after 3 consecutive failures.
 * Reactivates reviewing agents that pass the probe.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { probeEndpointSync } from '@/lib/agents/health-probe'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const maxDuration = 120  // Consistent with other crons in this repo (reconcile-onchain, etc.)

const BATCH_SIZE = 10
const FAILURE_THRESHOLD = 3

export async function GET(req: Request) {
  // Auth — same pattern as all other crons
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const svc = createServiceClient()

  // Fetch agents to check: active ones + reviewing ones (to reactivate if recovered)
  // Only agents with endpoint_url — skip internal/null endpoint agents
  const { data: agents, error } = await svc
    .from('agents')
    .select('id, slug, endpoint_url, status, consecutive_failures')
    .in('status', ['active', 'reviewing'])
    .not('endpoint_url', 'is', null)
    .order('last_checked_at', { ascending: true, nullsFirst: true })  // prioritize never-checked
    .limit(BATCH_SIZE)

  if (error) {
    logger.error('[health-cron] Failed to fetch agents', { error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let checked = 0, passed = 0, failed = 0, reactivated = 0

  for (const agent of (agents ?? [])) {
    try {
      const result = await probeEndpointSync(agent.endpoint_url!)
      checked++

      if (result.passed) {
        passed++
        const wasReviewing = agent.status === 'reviewing'
        await svc.from('agents').update({
          consecutive_failures: 0,
          health_check:    result.healthCheck,
          last_checked_at: new Date().toISOString(),
          // Reactivate only if it was in reviewing AND had failures (not manually paused)
          ...(wasReviewing && agent.consecutive_failures > 0 ? { status: 'active' } : {}),
        }).eq('id', agent.id)

        if (wasReviewing && agent.consecutive_failures > 0) reactivated++
      } else {
        failed++
        const newFailures = (agent.consecutive_failures ?? 0) + 1
        const shouldDegrade = newFailures >= FAILURE_THRESHOLD

        await svc.from('agents').update({
          consecutive_failures: newFailures,
          health_check:    result.healthCheck,
          last_checked_at: new Date().toISOString(),
          ...(shouldDegrade ? { status: 'reviewing' } : {}),
        }).eq('id', agent.id)

        logger.warn('[health-cron] Agent probe failed', {
          slug: agent.slug,
          consecutive_failures: newFailures,
          degraded: shouldDegrade,
          reason: result.healthCheck.reason,
        })
      }
    } catch (err) {
      logger.error('[health-cron] Unexpected error probing agent', {
        slug: agent.slug,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({ checked, passed, failed, reactivated })
}
```

**Build gate:** `npx tsc --noEmit`

## Wave 3 — Agregar a vercel.json
**Archivo:** `vercel.json`

Agregar al array `crons`:
```json
{
  "path": "/api/cron/health-check-agents",
  "schedule": "0 * * * *"
}
```

**Build gate:** `npx tsc --noEmit` + verificar JSON válido con `python3 -m json.tool vercel.json`

## Wave 4 — Agregar consecutive_failures al tipo Model
**Archivo:** `src/features/models/types/models.types.ts`

Agregar al interface `Model`:
```typescript
// WAS-281: contador de fallos consecutivos de health probe
consecutive_failures: number
```

**Build gate:** `npx tsc --noEmit`

## Rollback
```bash
git revert HEAD  # revert vercel.json + route
# Para la migration: supabase migration down (o ALTER TABLE agents DROP COLUMN consecutive_failures)
```

## Critical Constraints
- OBLIGATORIO `export const runtime = 'nodejs'` — `probeEndpointSync` usa `node:https`
- OBLIGATORIO `maxDuration = 120` — consistente con los otros crons del repo (reconcile-onchain, etc.). Vercel Pro lo soporta.
- PROHIBIDO await en loop sin límite — el BATCH_SIZE de 10 garantiza que el cron termina en < 60s
- PROHIBIDO cambiar status de agentes con `consecutive_failures = 0` al reactivar — pueden haber sido puestos en reviewing manualmente
