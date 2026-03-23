# SDD WAS-281 — Mensaje 429 mutex más claro
**Clasificación:** FAST-FIX
**Archivo único:** `src/app/api/v1/models/[slug]/invoke/route.ts`

## Context
El mutex Redis de NA-203 devuelve `429` con body `{ error: 'Concurrent invocation...' }` y header `Retry-After: 5`. El body no incluye `retry_after_seconds` ni un `hint` legible por máquina, lo que dificulta el manejo automático en clientes A2A.
El path de Redis-unavailable (503) tampoco incluye `retry_after_seconds`.

## Acceptance Criteria
- AC1: WHEN se devuelve 429 por mutex THEN body incluye `retry_after_seconds: 5` y `hint: "A call is already in progress for this key. Wait and retry."`
- AC2: WHEN Retry-After header ya es '5' THEN `retry_after_seconds` coincide con ese valor
- AC3: WHEN Redis unavailable y se retorna 503 THEN body también incluye `retry_after_seconds: 5` para consistencia

## Wave 0 — Pre-flight
- [ ] Leer líneas 264-295 de `src/app/api/v1/models/[slug]/invoke/route.ts` (bloque mutex + Redis-unavailable)
- [ ] Confirmar que el cambio no afecta ningún test existente (grep `concurrent_invocation` en `__tests__`)
- [ ] Build gate: `cd wasiai-v2 && npx tsc --noEmit 2>&1 | head -20`

## Wave 1 — Cambio en el 429 del mutex
**Archivo:** `src/app/api/v1/models/[slug]/invoke/route.ts`

Localizar el bloque:
```typescript
return NextResponse.json(
  { error: 'Concurrent invocation in progress for this key', code: 'concurrent_invocation' },
  { status: 429, headers: { 'Retry-After': '5' } }
)
```

Reemplazar con:
```typescript
return NextResponse.json(
  {
    error: 'Concurrent invocation in progress for this key',
    code: 'concurrent_invocation',
    retry_after_seconds: 5,
    hint: 'A call is already in progress for this key. Wait and retry.',
  },
  { status: 429, headers: { 'Retry-After': '5' } }
)
```

**Build gate:** `npx tsc --noEmit`

## Wave 2 — Consistencia en el 503 Redis-unavailable
**Archivo:** mismo

Localizar el bloque:
```typescript
return NextResponse.json(
  { error: 'Service temporarily unavailable. Please retry.' },
  {
    status: 503,
    headers: { 'Retry-After': '5' },
  },
)
```

Reemplazar con:
```typescript
return NextResponse.json(
  {
    error: 'Service temporarily unavailable. Please retry.',
    retry_after_seconds: 5,
  },
  {
    status: 503,
    headers: { 'Retry-After': '5' },
  },
)
```

**Build gate:** `npx tsc --noEmit`

## Rollback
`git revert HEAD` — cambio aislado en un solo archivo, sin migraciones.

## Critical Constraints
- PROHIBIDO cambiar el header `Retry-After` ni el status code
- PROHIBIDO tocar lógica de mutex, TTL, ni adquisición del lock
