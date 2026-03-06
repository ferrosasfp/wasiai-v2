# Story File #034 — WAS-134: Rate limiter fallback 503
> Dev lee SOLO este archivo. No consultar SDD ni Work Item.

## Goal
Cambiar el comportamiento fail-open del rate limiter cuando Upstash no está disponible.
Actualmente: si Upstash falla, se permite la request (fail-open silencioso).
Después: si Upstash falla, retornar 503 + `Retry-After: 60` (fail-closed explícito).

## Acceptance Criteria
- AC1: WHEN Upstash lanza excepción en `checkCreatorRateLimits` → 503 + `Retry-After: 60`
- AC2: WHEN Upstash lanza excepción en `checkRateLimit` → 503 + `Retry-After: 60`
- AC3: WHILE Upstash disponible → comportamiento idéntico al actual (sin regresión)
- AC4: IF Upstash no disponible → loggear `[rate-limit] upstash-unavailable` + el error

## Archivo a modificar

| Archivo | Acción | Exemplar |
|---------|--------|---------|
| `src/lib/ratelimit.ts` | Modificar 2 funciones | El archivo mismo — leer antes de tocar |

**NO tocar ningún otro archivo.**

## Exemplars — leer antes de implementar

### Patrón actual `checkCreatorRateLimits` (líneas ~130-155 de ratelimit.ts)
```typescript
// ANTES (fail-open):
} catch {
  logger.warn('[rate-limit] checkCreatorRateLimits fail-open', { slug })
}
return null

// DESPUÉS (fail-closed):
} catch (err) {
  logger.warn('[rate-limit] upstash-unavailable', { slug, err })
  return NextResponse.json(
    { error: 'Service temporarily unavailable', code: 'rate_limit_unavailable' },
    { status: 503, headers: { 'Retry-After': '60' } },
  )
}
```

### Patrón actual `checkRateLimit` (líneas ~95-120 de ratelimit.ts)
```typescript
// ANTES (sin try/catch — deja propagar el error al caller):
export async function checkRateLimit(limiter, identifier) {
  const { success, limit, reset } = await limiter.limit(identifier)
  // ...
}

// DESPUÉS (wrappear en try/catch):
export async function checkRateLimit(limiter, identifier) {
  try {
    const { success, limit, reset } = await limiter.limit(identifier)
    // ... lógica existente sin cambios ...
  } catch (err) {
    logger.warn('[rate-limit] upstash-unavailable', { identifier, err })
    return NextResponse.json(
      { error: 'Service temporarily unavailable', code: 'rate_limit_unavailable' },
      { status: 503, headers: { 'Retry-After': '60' } },
    )
  }
}
```

## Constraint Directives

### OBLIGATORIO
- Usar `logger.warn` (no `logger.error`) — Upstash down es outage externo, no bug nuestro
- `Retry-After: 60` como string fijo — no calcular dinámicamente
- Mantener el mismo shape JSON de error: `{ error: string, code: string }`
- Leer el archivo completo antes de modificar — anti-alucinación

### PROHIBIDO
- NO cambiar firmas de funciones (`Promise<NextResponse | null>` se mantiene)
- NO tocar call sites (invoke, compose, demo, agent-keys, etc.)
- NO modificar Redis singleton ni constructores de Ratelimit
- NO agregar dependencias nuevas
- NO cambiar el comportamiento cuando Upstash SÍ está disponible

## Waves

### W0 — Modificar ratelimit.ts (serial)
1. Leer `src/lib/ratelimit.ts` completo
2. Wrappear `checkRateLimit` en try/catch → 503 si falla
3. Cambiar catch de `checkCreatorRateLimits` → 503 en lugar de `return null`
4. Verificar: `npx tsc --noEmit` pasa sin errores

### W1 — Tests (después de W0)
1. Leer `src/app/api/creator/__tests__/test-endpoint.test.ts` como exemplar de mocking
2. Crear `src/lib/__tests__/ratelimit-fallback.test.ts`
3. Tests requeridos:
   - `checkRateLimit` → 503 cuando `limiter.limit()` lanza excepción
   - `checkCreatorRateLimits` → 503 cuando Upstash lanza excepción
   - `checkRateLimit` → null cuando OK (no regresión)
   - `checkCreatorRateLimits` → 429 cuando excede límite (no regresión)

## Out of Scope
- NO agregar feature flag para toggle fail-open/fail-closed
- NO implementar in-memory fallback limiter
- NO modificar comportamiento de Redis singleton
- NO tocar otros endpoints

## Escalation Rule
Si algo no está en este Story File → PARAR y preguntar al Architect. No inventar.
