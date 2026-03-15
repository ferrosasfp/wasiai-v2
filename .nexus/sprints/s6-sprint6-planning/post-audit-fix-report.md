# Post-Audit Fix Report — Sprint 6 WasiAI
**Builder:** NexusAgil v1.3  
**Fecha:** 2026-03-14  
**Commit:** `45b9bedf3`  
**Build:** ✅ Exitoso (exit code 0)

---

## BLOQUEANTES

### ✅ F-01: settlement_failures sin RLS — RESUELTO
**Archivo:** `supabase/migrations/059_settlement_failures.sql`  
**Acción:** Se habilitó Row Level Security en la tabla `settlement_failures` y se creó la política `settlement_failures_service_only` que bloquea acceso desde roles `authenticated` y `anon` vía PostgREST. El acceso queda restringido exclusivamente al `service_role` (backend).

### ✅ F-02: /api/admin/status sin auth — RESUELTO
**Archivo:** `src/app/api/admin/status/route.ts`  
**Nota previa:** El endpoint tenía un comentario que decía "Sin auth requerida — el panel verifica ownership en cliente con wallet." — esto es insuficiente ya que cualquiera puede llamar la API directamente.  
**Acción:** Se añadió verificación de API key al inicio del handler GET. Valida header `Authorization: Bearer <ADMIN_SECRET>` contra la variable de entorno `ADMIN_SECRET`. Si la variable no está configurada o el token no coincide, retorna 401 Unauthorized. Se requiere configurar `ADMIN_SECRET` en el entorno de producción.

---

## NO BLOQUEANTES

### ✅ F3: .then() no verifica res.error en settlement_failures insert — RESUELTO
**Archivo:** `src/app/api/v1/models/[slug]/invoke/route.ts`  
**Acción:** El `.then(() => {...})` fue reemplazado por `.then((res) => {...})` que verifica `res.error`. Si hay error de DB, se loguea como `error` con el mensaje. Si el insert fue exitoso, se loguea como `warn` con el contexto original.

### ✅ F4: Queries a settlement_failures en admin/status sin .catch individual — RESUELTO
**Archivo:** `src/app/api/admin/status/route.ts`  
**Acción:** Las dos queries de `settlement_failures` dentro del `Promise.all` ahora encadenan `.then((r) => r.error ? { count: 0 } : r)` como fallback. Si la tabla no existe (rama sin migración aplicada), retornan `{ count: 0 }` en lugar de romper el `Promise.all` completo con un 500.

### ✅ F6: Number("") → 0 pasa NaN guard — RESUELTO
**Archivo:** `src/app/api/v1/agents/route.ts`  
**Acción:** La condición cambió de `if (minPerfRaw !== null)` a `if (minPerfRaw !== null && minPerfRaw.trim() !== '')`. Esto evita que `min_performance=` (string vacío) se interprete como `0`, ignorando correctamente el parámetro cuando está vacío.

### 📋 F5: min_performance ignorado en modo slim y search — DEUDA TÉCNICA
**Archivo:** `src/app/api/v1/agents/route.ts`  
**Documentado como deuda técnica. No modificado en este fix.**  
`min_performance` se valida y aplica en el path principal (query Supabase normal), pero cuando la route usa el path RPC de búsqueda (`search_agents`) o modo `slim=true`, el filtro no se propaga al RPC call. Esto significa que una búsqueda `?q=chatbot&min_performance=80` retorna agentes con score menor a 80.  
**Solución propuesta (Sprint 7):** Pasar `min_performance` como parámetro al RPC `search_agents` y ajustar la función SQL para aplicar el filtro. Alternativamente, filtrar el resultado en memoria post-RPC como workaround temporal.

---

## Resumen

| Finding | Tipo | Estado |
|---------|------|--------|
| F-01 RLS settlement_failures | Bloqueante | ✅ Resuelto |
| F-02 Auth admin/status | Bloqueante | ✅ Resuelto |
| F3 Supabase res.error check | No bloqueante | ✅ Resuelto |
| F4 Promise.all fallback | No bloqueante | ✅ Resuelto |
| F5 min_performance slim/search | No bloqueante | 📋 Deuda técnica S7 |
| F6 Number("") → 0 | No bloqueante | ✅ Resuelto |

**Build:** ✅ `npm run build` exitoso  
**Commit:** `45b9bedf3` — `fix(S6-audit): RLS en settlement_failures + auth admin/status + fix Supabase error check`
