# Story File — SDD #053: Redis mutex fail-closed en invoke/route.ts
**Sprint TBD | WAS-164**
**Classification: QUALITY**
**Source of truth: this file only. Read every file before modifying.**

## Context

En `/api/v1/models/[slug]/invoke/route.ts`, el mutex Redis para prevenir double-spend hace fail-open cuando Redis no está disponible (línea 249-250). Esto significa que si Redis cae, llamadas concurrentes con la misma API key pueden gastar más de su budget.

**Decisión requerida del PO:** fail-closed (503) vs fail-open+alert.

**Recomendación técnica:** fail-closed (503) para API keys con budget on-chain (dinero real en juego). El rate limiter de Upstash es una capa diferente que también puede fallar.

**Riesgo: MEDIUM** — double-spend concurrente cuando Redis no disponible.

## Acceptance Criteria

1. Cuando Redis no está disponible, el endpoint retorna 503 con `Retry-After: 5`
2. Se loguea un error con nivel `error` (no `warn`) para alerting
3. Se agrega un health-check comment explicando la decisión
4. Build pasa sin errores

## Wave 1 — Cambiar fail-open a fail-closed

**Archivo:** `src/app/api/v1/models/[slug]/invoke/route.ts`

Buscar el bloque catch del mutex (~línea 248-250) y cambiar:

```typescript
// ANTES (fail-open):
// Redis unavailable — fail-open (rate limiting still applies)
logger.warn('[invoke] Redis mutex unavailable — proceeding without mutex', { keyId: keyRow.id })

// DESPUÉS (fail-closed):
// NG-105: Redis unavailable — fail-closed to prevent double-spend
logger.error('[invoke] Redis mutex unavailable — rejecting request', {
  keyId: keyRow.id,
  error: err instanceof Error ? err.message : String(err),
})
return NextResponse.json(
  { error: 'Service temporarily unavailable. Please retry.' },
  {
    status: 503,
    headers: { 'Retry-After': '5' },
  },
)
```

## Wave 2 — Commit + Push

```bash
git add -A
git commit -m "fix(NG-105): redis mutex fail-closed to prevent double-spend [WAS-164]"
git push
```

## Critical Constraints

- Solo cambiar el comportamiento del mutex Redis, NO del rate limiter de Upstash
- El `Retry-After` header es obligatorio para 503
- NO cambiar el TTL del mutex (15s está correcto)
- El mutex solo aplica cuando hay API key con budget — verificar que el path sin key no se vea afectado
