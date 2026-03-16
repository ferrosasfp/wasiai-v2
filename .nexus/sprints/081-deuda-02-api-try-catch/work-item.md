# DEUDA-02 — APIs sin manejo de errores (try/catch + Supabase error values)

**Tipo:** FAST-FIX | **Fecha:** 2026-03-15 | **Prioridad:** Media

---

## Contexto

`GET /api/v1/agents/[slug]`, `GET /api/v1/agents`, y `GET /api/v1/agents/discover` no manejan errores correctamente. El cliente Supabase JS **retorna errores como valores** (`{ data: null, error }`) en vez de lanzar excepciones — por eso un `try/catch` no es suficiente. Además, slug inexistente (404) no debe devolver 503.

**Archivos afectados:**
- `src/app/api/v1/agents/[slug]/route.ts`
- `src/app/api/v1/agents/route.ts`
- `src/app/api/v1/agents/discover/route.ts`

---

## Scope

**IN:**
- Agregar validación `if (error)` tras cada query Supabase (no solo try/catch)
- Envolver handlers en try/catch para errores de red/timeout
- Diferenciar 404 (not found) de 503 (service error)
- Logging interno antes de suprimir stack trace
- Headers CORS en todas las respuestas de error

**OUT:**
- No cambiar estructura de respuesta happy path
- No modificar otros endpoints fuera de los 3 mencionados

---

## Acceptance Criteria (EARS)

**AC-1:** WHEN Supabase retorna `{ data: null, error: <supabase_error> }` en `GET /api/v1/agents/{slug}`, THEN SHALL devolver `{"error":"internal_error","message":"Service temporarily unavailable"}` con status 503 y headers CORS, sin exponer el error de Supabase.

**AC-2:** WHEN Supabase retorna `{ data: null, error }` en `GET /api/v1/agents` (list), THEN SHALL devolver mismo formato con 503 y headers CORS.

**AC-3:** WHEN Supabase retorna `{ data: null, error }` en `GET /api/v1/agents/discover`, THEN SHALL devolver mismo formato con 503 y headers CORS.

**AC-4:** WHEN el slug recibido no existe en BD (row not found, `data === null` sin error), THEN `GET /api/v1/agents/{slug}` SHALL devolver `{"error":"not_found","message":"Agent not found"}` con status **404**, no 503.

**AC-5:** WHEN se devuelve cualquier respuesta de error (4xx/5xx), THEN SHALL incluir los mismos headers CORS que la respuesta happy path.

**AC-6:** WHEN ocurre cualquier error (Supabase error value o excepción de red), THEN SHALL loguearse internamente con `console.error` antes de devolver la respuesta de error (para observabilidad).

---

## Constraints

- El try/catch captura errores de red y timeouts; `if (error)` captura errores de Supabase JS
- Ambos patrones son necesarios — no es suficiente solo uno
- Nunca exponer `error.message` de Supabase en la respuesta HTTP
- El status 503 es para errores de servicio; 404 para not found; 400 para input inválido
