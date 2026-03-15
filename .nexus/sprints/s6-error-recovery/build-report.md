# Build Report — S6-01: Error Recovery Post-Settlement

**Fecha:** 2026-03-14  
**Sprint:** S6 | Story: S6-01  
**Commit:** `edb3461c8`  
**Status:** ✅ BUILD OK — sin errores TypeScript

---

## Archivos modificados

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `supabase/migrations/059_settlement_failures.sql` | Creado | Tabla `settlement_failures` con índices condicionales |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Modificado | Captura `callId` de `logCall()`, insert fire-and-forget post-settlement-failure |
| `src/app/api/admin/status/route.ts` | Modificado | Query `settlement_failures_pending` añadida al response |

---

## Notas de implementación

- **Fix TypeScript:** Supabase query builder retorna `PromiseLike<void>`, no `Promise`. Se envolvió con `Promise.resolve()` para poder encadenar `.catch()` — consistente con el patrón existente de `increment_pending_earnings`.
- **fire-and-forget:** `void Promise.resolve(supabase.from(...).insert(...)).then(...).catch(...)` — nunca bloquea response.
- **callId:** Capturado del return de `logCall()` como `const { id: callId }` — sin modificar `logCall()`.
- **Acceptance criteria:** Todos cumplidos (AC1–AC5 del SDD).

---

## Build output (últimas líneas)

```
├ ƒ /api/v1/webhooks/[id]
├ ƒ /api/v1/webhooks/[id]/deliveries
└ ƒ /api/v1/webhooks/[id]/test

ƒ Proxy (Middleware)
○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

**TypeScript:** ✅ Clean  
**Next.js build:** ✅ Successful
