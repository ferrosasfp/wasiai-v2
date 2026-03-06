# Story File — SDD #024: WAS-73 Circuit Breaker
**Sprint 13 | WAS-73**
**Classification: QUALITY — HU-MAJOR**
**Source of truth: this file only. Read every file before modifying.**

---

## Context

WasiAI llama a proveedores externos (OpenAI, Anthropic, etc.).
Si un proveedor falla, sin proteccion todos los usuarios reciben timeouts lentos.
El circuit breaker detecta el patron de fallas y responde inmediatamente con fallback.

Estado persiste en Upstash Redis (ya configurado) — no en memoria,
porque Vercel mata y revive procesos entre requests.

---

## Acceptance Criteria

- AC1: 3 estados: closed (normal) | open (bloqueado) | half-open (probando)
- AC2: Umbral: 5 fallos consecutivos en 120s → open
- AC3: Despues de 30s en open → half-open → permite 1 request de prueba
- AC4: Si la prueba tiene exito → closed + reset contador
- AC5: Si la prueba falla → open + actualiza timestamp
- AC6: Estado persiste en Upstash Redis (claves por proveedor)
- AC7: GET /api/v1/admin/circuit-breakers → lista estado de todos los proveedores
- AC8: POST /api/v1/admin/circuit-breakers/:id/reset → reset manual (onlyOwner)
- AC9: npx tsc --noEmit = 0 errores

---

## Wave 1 — CircuitBreaker Service

Crear: `src/lib/circuit-breaker/CircuitBreaker.ts`

```typescript
import { Redis } from '@upstash/redis'

const redis = Redis.fromEnv()

export type CBState = 'closed' | 'open' | 'half-open'

const FAILURE_THRESHOLD = 5
const RECOVERY_TIMEOUT  = 30 // seconds
const WINDOW_SECONDS    = 120

function keys(providerId: string) {
  return {
    state:       `cb:provider:${providerId}:state`,
    failures:    `cb:provider:${providerId}:failures`,
    lastFailure: `cb:provider:${providerId}:last_failure`,
  }
}

export async function getState(providerId: string): Promise<CBState> {
  const k = keys(providerId)
  const state = await redis.get<CBState>(k.state)
  if (!state) return 'closed'

  if (state === 'open') {
    const lastFailure = await redis.get<number>(k.lastFailure)
    if (lastFailure && Date.now() / 1000 - lastFailure >= RECOVERY_TIMEOUT) {
      await redis.set(k.state, 'half-open', { ex: 300 })
      return 'half-open'
    }
  }
  return state
}

export async function recordSuccess(providerId: string): Promise<void> {
  const k = keys(providerId)
  await redis.del(k.state)
  await redis.del(k.failures)
  await redis.del(k.lastFailure)
}

export async function recordFailure(providerId: string): Promise<void> {
  const k = keys(providerId)
  const failures = await redis.incr(k.failures)
  await redis.set(k.lastFailure, Math.floor(Date.now() / 1000))
  await redis.expire(k.failures, WINDOW_SECONDS)

  if (failures >= FAILURE_THRESHOLD) {
    await redis.set(k.state, 'open', { ex: 300 }) // max 5min safety TTL
    await redis.set(k.lastFailure, Math.floor(Date.now() / 1000))
  }
}

export async function resetCircuit(providerId: string): Promise<void> {
  const k = keys(providerId)
  await redis.del(k.state)
  await redis.del(k.failures)
  await redis.del(k.lastFailure)
}

export async function wrapWithCircuitBreaker<T>(
  providerId: string,
  fn: () => Promise<T>
): Promise<T> {
  const state = await getState(providerId)

  if (state === 'open') {
    throw new Error(`Provider ${providerId} is currently unavailable. Try again shortly.`)
  }

  try {
    const result = await fn()
    await recordSuccess(providerId)
    return result
  } catch (err) {
    await recordFailure(providerId)
    throw err
  }
}
```

---

## Wave 2 — Admin API Routes

### GET /api/v1/admin/circuit-breakers/route.ts

```typescript
import { NextResponse } from 'next/server'
import { getState } from '@/lib/circuit-breaker/CircuitBreaker'
import { verifyAdminSignature } from '@/lib/admin/verifyAdminSignature' // ya existe

// Leer de env var o config — NO hardcodear
const PROVIDERS = (process.env.AI_PROVIDERS ?? 'openai,anthropic').split(',')

export async function GET(req: Request) {
  const isAdmin = await verifyAdminSignature(req)
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const statuses = await Promise.all(
    PROVIDERS.map(async (id) => ({ id, state: await getState(id) }))
  )
  return NextResponse.json({ providers: statuses })
}
```

### POST /api/v1/admin/circuit-breakers/[id]/reset/route.ts

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { resetCircuit } from '@/lib/circuit-breaker/CircuitBreaker'
import { verifyAdminSignature } from '@/lib/admin/verifyAdminSignature'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const isAdmin = await verifyAdminSignature(req)
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await resetCircuit(params.id)
  return NextResponse.json({ ok: true, providerId: params.id, state: 'closed' })
}
```

---

## Wave 3 — Verificar Upstash Redis

```bash
grep -r "UPSTASH_REDIS\|upstash/redis" /home/ferdev/.openclaw/workspace/wasiai-v2/.env.local
grep -r "@upstash/redis" /home/ferdev/.openclaw/workspace/wasiai-v2/package.json
```

Si `@upstash/redis` no esta instalado: `npm install @upstash/redis`
Si las env vars no existen, documentarlo en el PR como prerequisito.

---

## Wave 4 — TypeScript check + commit

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2
npx tsc --noEmit 2>&1
git add src/lib/circuit-breaker/ src/app/api/v1/admin/circuit-breakers/
git commit -m "feat(WAS-73): circuit breaker with Upstash Redis persistence"
git push origin master master:main
```

---

## Critical Constraints

1. Leer src/lib/admin/verifyAdminSignature.ts antes de importarlo — verificar firma exacta
2. Si @upstash/redis no existe en package.json, instalarlo y documentarlo
3. El listado de proveedores (PROVIDERS array) debe leerse de una config, no hardcodeado
4. wrapWithCircuitBreaker debe usarse en el invoke route existente — leer ese archivo primero
5. Half-open permite SOLO 1 request concurrente de prueba — en Vercel serverless esto es best-effort
6. Agregar AI_PROVIDERS a .env.local con los proveedores activos del proyecto. Leer src/app/api/v1/models/ para identificar qué proveedores usa el proyecto actualmente.
