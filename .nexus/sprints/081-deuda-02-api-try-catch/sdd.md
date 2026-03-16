# SDD — DEUDA-02: APIs sin manejo de errores

**Issue:** DEUDA-02 | **Clasificación:** FAST-FIX | **Fecha:** 2026-03-15

---

## Context

3 endpoints de agentes no manejan correctamente los errores de Supabase. El cliente Supabase JS retorna `{ data: null, error }` sin lanzar excepción, por lo que `try/catch` solo no es suficiente. Además un slug inexistente devuelve error genérico en vez de 404.

**Archivos a modificar:**
- `src/app/api/v1/agents/[slug]/route.ts`
- `src/app/api/v1/agents/route.ts`
- `src/app/api/v1/agents/discover/route.ts`

---

## Wave 0 — Pre-flight

```bash
# Verificar estado actual
grep -n "try\|catch\|error\b" src/app/api/v1/agents/\[slug\]/route.ts | head -20
grep -n "try\|catch\|if.*error" src/app/api/v1/agents/route.ts | head -10
grep -n "try\|catch" src/app/api/v1/agents/discover/route.ts | head -10
```

Expected: ningún try/catch en los 3 archivos.

---

## Wave 1 — `/api/v1/agents/[slug]/route.ts`

**Cambio:** Agregar validación de error Supabase + try/catch envolvente.

```typescript
// ANTES — en GET handler, después de la query:
if (error || !agent) {
  return NextResponse.json(
    { error: 'agent_not_found', ... },
    { status: 404, headers: CORS }
  )
}

// DESPUÉS — envolver todo el handler + distinguir error vs not found:
export async function GET(...) {
  try {
    const { slug } = await params
    const supabase = await createClient()

    const { data: agent, error } = await supabase
      .from('agents')
      .select(`...`)
      .eq('slug', slug)
      .eq('status', 'active')
      .single()

    // Error de Supabase (red, auth, etc.) → 503
    if (error && error.code !== 'PGRST116') {
      console.error('[agents/slug] Supabase error:', error.message)
      return NextResponse.json(
        { error: 'internal_error', message: 'Service temporarily unavailable' },
        { status: 503, headers: CORS }
      )
    }

    // Not found (PGRST116 = no rows) → 404
    if (!agent) {
      return NextResponse.json(
        { error: 'not_found', message: `Agent not found: ${slug}` },
        { status: 404, headers: CORS }
      )
    }

    // ... resto del handler ...

  } catch (err) {
    console.error('[agents/slug] Unexpected error:', err)
    return NextResponse.json(
      { error: 'internal_error', message: 'Service temporarily unavailable' },
      { status: 503, headers: CORS }
    )
  }
}
```

**Build gate Wave 1:**
```bash
npx tsc --noEmit 2>&1 | grep "agents/\[slug\]" | head -5
```
Expected: sin errores de TypeScript.

---

## Wave 2 — `/api/v1/agents/route.ts` — branch RPC de búsqueda

**Cambio:** Corregir branch de búsqueda RPC (~línea 67) que expone `error.message` de Supabase:

```typescript
// ANTES (~línea 67):
if (searchError) {
  return NextResponse.json({ error: searchError.message }, { status: 500 })
}

// DESPUÉS:
if (searchError) {
  console.error('[agents/search] Supabase RPC error:', searchError.message)
  return NextResponse.json(
    { error: 'internal_error', message: 'Service temporarily unavailable' },
    { status: 503, headers: corsWithPagination }
  )
}
```

**Build gate Wave 2a:**
```bash
grep -n "searchError.message" src/app/api/v1/agents/route.ts
# Expected: 0 resultados
```

## Wave 2b — `/api/v1/agents/route.ts` — query principal

**Cambio:** Envolver el bloque de query principal en try/catch + validar `error` de Supabase.

```typescript
// Envolver la query principal:
let result
try {
  result = await supabase.from('agents').select(`...`).eq(...)
} catch (err) {
  console.error('[agents] Unexpected error:', err)
  return NextResponse.json(
    { error: 'internal_error', message: 'Service temporarily unavailable' },
    { status: 503, headers: corsWithPagination }
  )
}

const { data: agents, error, count } = result

if (error) {
  console.error('[agents] Supabase error:', error.message)
  return NextResponse.json(
    { error: 'internal_error', message: 'Service temporarily unavailable' },
    { status: 503, headers: corsWithPagination }
  )
}
```

**Build gate Wave 2:**
```bash
npx tsc --noEmit 2>&1 | grep "agents/route" | head -5
```

---

## Wave 3 — `/api/v1/agents/discover/route.ts`

Mismo patrón que Wave 2 — envolver query + validar error.

**Build gate Wave 3:**
```bash
npx tsc --noEmit 2>&1 | grep "discover" | head -5
```

---

## Wave 4 — Build final + commit

```bash
npx tsc --noEmit 2>&1 | head -20
# Expected: 0 errores
git add src/app/api/v1/agents/\[slug\]/route.ts src/app/api/v1/agents/route.ts src/app/api/v1/agents/discover/route.ts
git commit -m "fix(DEUDA-02): handle Supabase error values + try/catch in agents API endpoints"
git push
```

---

## Rollback

```bash
git revert HEAD --no-edit && git push
```

---

## Critical Constraints

- **OBLIGATORIO:** `console.error` antes de devolver 503 (no perder observabilidad)
- **PROHIBIDO:** exponer `error.message` de Supabase en la respuesta HTTP
- **OBLIGATORIO:** headers CORS en todas las respuestas de error
- `PGRST116` es el código de Supabase para "no rows returned" → 404, no 503
