# SDD — WAS-208: GET /api/v1/capabilities

**Issue:** WAS-208  
**Clasificación:** HU-MINOR  
**Fecha:** 2026-03-14  
**Estado:** SPEC_APPROVED

---

## Context

El campo `capability` en Compose steps no tiene documentación pública de qué valores son válidos. El endpoint `GET /api/v1/agents/discover` ya filtra por capability internamente, pero no expone el catálogo.

`capabilities` en la tabla `agents` es JSONB con estructura `[{"name": "price_oracle"}, ...]`.

**Exemplar:** `src/app/api/v1/agents/discover/route.ts` — mismo patrón de query pública sin auth.

---

## Acceptance Criteria (EARS)

- **AC-1:** WHEN `GET /api/v1/capabilities`, THEN el sistema SHALL retornar array de strings únicos, ordenados alfabéticamente, con todos los capabilities de agentes activos (`status = 'active'`).
- **AC-2:** WHEN no hay agentes con capabilities definidos, THEN el sistema SHALL retornar `[]`.
- **AC-3:** WHEN el request incluye `?category=defi`, THEN el sistema SHALL filtrar capabilities solo de agentes en esa categoría.
- **AC-4:** WHEN el endpoint responde, THEN SHALL incluir `Cache-Control: public, max-age=300` (5 min — catálogo cambia poco).
- **AC-5:** WHEN capabilities es NULL o `[]` en un agente, THEN ese agente SHALL ser ignorado silenciosamente.

---

## Wave 0 — Pre-flight

- [ ] Verificar que `capabilities` es JSONB en `doc/DB_SCHEMA.md` ✅
- [ ] Confirmar estructura del JSONB: `[{"name": "string"}]` ✅ (ver discover/route.ts:42)
- [ ] Confirmar ruta: `src/app/api/v1/capabilities/route.ts` (nueva)
- [ ] No requiere migración DB
- [ ] No requiere auth

---

## Wave 1 — Implementación

### Archivo nuevo
`src/app/api/v1/capabilities/route.ts`

```typescript
/**
 * GET /api/v1/capabilities
 * WAS-208: Lista pública de capabilities registrados en agentes activos.
 * Permite a developers y agentes conocer qué capabilities pueden usar en Compose.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const category = searchParams.get('category') ?? null

  const supabase = await createClient()

  let query = supabase
    .from('agents')
    .select('capabilities, category')
    .eq('status', 'active')
    .not('capabilities', 'is', null)

  if (category) {
    query = query.eq('category', category)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch capabilities' }, { status: 500 })
  }

  // Extraer nombres únicos de capabilities y ordenar
  const capSet = new Set<string>()
  for (const agent of data ?? []) {
    const caps = agent.capabilities as Array<{ name: string }> | null
    if (Array.isArray(caps)) {
      for (const c of caps) {
        if (c?.name) capSet.add(c.name.toLowerCase())
      }
    }
  }

  const capabilities = Array.from(capSet).sort()

  return NextResponse.json(
    { capabilities, total: capabilities.length },
    { headers: { 'Cache-Control': 'public, max-age=300' } }
  )
}
```

### Build gate Wave 1
```bash
npx tsc --noEmit   # 0 errores
curl http://localhost:3000/api/v1/capabilities  # retorna JSON
```

---

## Rollback

Eliminar `src/app/api/v1/capabilities/route.ts`. No hay DB changes ni migraciones que revertir.

---

## Critical Constraints

- NO auth requerida — endpoint público
- NO tocar `sandbox/balance/route.ts`
- NO tocar `checkIpLimit`
- Cache 5 min — el catálogo de capabilities cambia poco
