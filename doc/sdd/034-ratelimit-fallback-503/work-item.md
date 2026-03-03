# Work Item #034 — WAS-134: Rate limiter fallback 503

| Campo | Valor |
|-------|-------|
| **#** | 034 |
| **HU** | WAS-134 |
| **Tipo** | improvement |
| **SDD_MODE** | full |
| **Objetivo** | Cuando Upstash no está disponible, el rate limiter falla de forma segura retornando 503 + Retry-After:60 en lugar de fail-open silencioso, evitando abuso durante outages |
| **Scope IN** | `src/lib/ratelimit.ts` — funciones `checkRateLimit` y `checkCreatorRateLimits` |
| **Scope OUT** | Redis singleton, Upstash config, circuit breaker, call sites, lógica de negocio de invoke |
| **Gate 1** | HU_APPROVED — 2026-03-03 |
| **Gate 2** | SPEC_APPROVED — 2026-03-03 |

## Acceptance Criteria (EARS)

- AC1: WHEN Upstash lanza una excepción en `checkCreatorRateLimits`, THE sistema SHALL retornar HTTP 503 con header `Retry-After: 60`
- AC2: WHEN Upstash lanza una excepción en `checkRateLimit`, THE sistema SHALL retornar HTTP 503 con header `Retry-After: 60`
- AC3: WHILE Upstash está disponible, THE comportamiento SHALL ser idéntico al actual (429 si excede, null si OK)
- AC4: IF Upstash no está disponible, THE sistema SHALL loggear `[rate-limit] upstash-unavailable` con el error para observabilidad
