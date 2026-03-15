# Spec Review — SDD #215

**Reviewer:** NexusAgil Spec Reviewer v1.3  
**Fecha:** 2026-03-14  
**Feature:** Health check async al registrar agente

---

## Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 `validateEndpointUrlAsync` | ✅ PASS | Existe en `src/lib/security/validateEndpointUrl.ts`, exportada correctamente. Incluye DNS probe (NG-005). |
| 0.2 Fire-and-forget pattern | ✅ PASS | `registerAgentOnChain().then(...).catch(...)` en register/route.ts (~línea 289) — patrón reutilizable confirmado. |
| 0.3 DB columns ausentes | ⚠️ PARCIAL | `health_check` y `last_checked_at` NO existen → migración necesaria ✅. PERO: migración 047 ya tiene `last_health_check_ok` (BOOLEAN) y `last_health_check_at` (TIMESTAMPTZ). Son columnas distintas que quedan huérfanas. Ver F1. |
| 0.4 Status route inexistente | ✅ PASS | `src/app/api/v1/agents/[slug]/status/route.ts` no existe — creación limpia confirmada. |
| 0.5 `createServiceClient` sin cookies | ✅ PASS | `createServiceClient()` es una función SÍNCRONA que usa `createSupabaseClient` directo con service_role key. No requiere cookies. Safe en contexto async. |
| 0.6 Conflicto creator status route | ⚠️ INFO | `src/app/api/creator/agents/[slug]/status/route.ts` YA EXISTE (PATCH — toggle active/paused/draft). El nuevo endpoint es `/api/v1/...` — rutas diferentes, sin colisión de path. Pero el SDD dice modificar `[slug]/route.ts`, no `[slug]/status/route.ts` — verificar que el PATCH de endpoint_url está en el archivo correcto. |
| 0.7 Auth pattern x-agent-key | ✅ PASS | Patrón completo en register/route.ts: SHA256 hash → lookup `agent_keys` → `owner_id`. Reutilizable en GET /status con verificación adicional de ownership del slug. |

---

## Coherencia

| Check | Resultado | Detalle |
|-------|-----------|---------|
| Cada AC tiene wave que lo implementa | ✅ | AC1→W4, AC2-3→W2, AC4-6→W3, AC7→W5, AC8-10→W2. Cobertura completa. |
| Build gate al final de cada wave | ✅ | `npx tsc --noEmit` en W1-W5. Consistente. |
| Rollback ejecutable | ✅ | `git revert` + `ALTER TABLE DROP COLUMN` — ejecutable. Columnas nullable no rompen nada. |
| Al menos 3 PROHIBIDO en constraints | ✅ | 3 PROHIBIDO declarados: (1) await probe en handler, (2) loggear endpoint_url completo, (3) modificar health route existente. |

---

## Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| F1 | 🚨 CRÍTICA | **Columnas legacy huérfanas post-migración.** Migration 047 ya creó `last_health_check_ok` (BOOLEAN) y `last_health_check_at` (TIMESTAMPTZ). El SDD crea `health_check` (JSONB) y `last_checked_at` (TIMESTAMPTZ) — nombres distintos. `updateAgentHealth()` NUNCA escribe en las columnas viejas. El índice `idx_agents_health_check` apunta a `last_health_check_ok` + `last_health_check_at` que quedarán permanentemente stale. Cualquier query que lea `last_health_check_ok` (hay código en /health route) verá NULL para siempre. | La migración 20260314220000 debe también: (a) hacer `DROP COLUMN last_health_check_ok` + `DROP COLUMN last_health_check_at` si no se usan, O (b) populares desde `health_check` via trigger/computed. Declarar decisión explícita en SDD. |
| F2 | 🚨 CRÍTICA | **Race condition: register/route.ts asigna `status: 'active'` para JWT auth, luego el probe puede revertir a `reviewing`.** El SDD dice que el registro SIEMPRE responde con `status: "reviewing"` (AC1), pero el código actual hace `status: authMethod === 'jwt' ? 'active' : 'reviewing'`. Wave 4 no resuelve este conflicto: ¿se elimina la lógica JWT=active? ¿se pasa todo a reviewing? Si no, JWT-authed agents pueden activarse y 300ms después el probe los revierte a `reviewing` sin que el caller lo sepa. | Especificar en Wave 4: el registro con JWT también inicia en `reviewing` si se activa el probe (y el response siempre devuelve `reviewing` + `status_url`). O bien: el probe no cambia de `active` a `reviewing` para JWT-auth (pero entonces hay que agregar condición en `updateAgentHealth`). Decisión OBLIGATORIA antes de implementar Wave 4. |
| F3 | 🔴 ALTA | **Double SSRF validation innecesaria.** `register/route.ts` ya llama `await validateEndpointUrlAsync(data.endpoint_url)` SINCRÓNICAMENTE antes del insert. El probe llama `validateEndpointUrlAsync` de nuevo como paso 1. Esto son 2 DNS lookups + potencialmente 2×5s de timeout en el peor caso (aunque el primero es awaited y el probe es async). Redundancia no documentada. | Documentar en el SDD si la segunda validación en el probe es intencional (anti DNS rebinding entre registro y probe) o si puede omitirse. Si es intencional — añadir comentario explícito en health-probe.ts. Si no — eliminar del probe y empezar directo en step 2 (fetch). |
| F4 | 🔴 ALTA | **Convención de nombre de migración rota.** Todas las migraciones existentes usan prefijo numérico secuencial (`047_`, `048_`, ..., `056_`). El SDD especifica `20260314220000_agents_health_check.sql` (timestamp). Supabase ordena migraciones alfabéticamente — `2026...` ordena DESPUÉS de `056_` en ASCII, pero la convención del proyecto es numérica. La migración siguiente que alguien cree como `057_` se aplicaría ANTES de `20260314220000_` alphabetically if `057` < `2026`. Rompe la secuencia del proyecto. | Renombrar a `057_agents_health_check.sql` siguiendo la convención establecida. Actualizar la referencia en el SDD. |
| F5 | 🔴 ALTA | **Probe body inconsistente con endpoint existente.** El SDD especifica `body: '{"input":"ping"}'`. El existente `GET /api/v1/agents/[slug]/health/route.ts` usa `body: '{"ping":true}'`. Agentes ya registrados y funcionando habrán implementado sus handlers esperando uno u otro formato. Cambiar el formato sin documentarlo puede hacer que agentes existentes fallen el health check al registrarse de nuevo. | Unificar. Preferiblemente usar el formato ya documentado en el endpoint existente `{"ping":true}` — o definir en el SDD que `{"input":"ping"}` es el formato oficial y actualizar el health route también (pero eso viola PROHIBIDO #3). La decisión más segura: usar `'{"ping":true}'` en el probe para compatibilidad. |
| F6 | 🟡 MEDIA | **`updateAgentHealth` no actualiza `last_health_check_at` legacy.** Relacionado con F1 pero específico al código: si se decide MANTENER las columnas legacy (en lugar de dropearlas), `updateAgentHealth` debe actualizar ambas: `last_health_check_at = new Date()` Y `last_health_check_ok = passed`. De lo contrario cualquier código que lea las columnas legacy (incluyendo el índice `idx_agents_health_check`) estará roto. | Si se mantienen columnas legacy: añadir a `updateAgentHealth`: `last_health_check_ok: status === 'active'`, `last_health_check_at: new Date().toISOString()`. |
| F7 | 🟡 MEDIA | **Wave 4 scope ambiguo respecto al response body.** El SDD dice que Wave 4 modifica register/route.ts para añadir `health_check: { pending: true }` y `status_url` en el response. Pero la sección 4 (Context Map) y el response actual devuelven `agent.status` directamente desde la DB. Si el response hardcodea `status: "reviewing"` en Wave 4 pero la DB puede tener `status: "active"` (JWT path), habrá inconsistencia entre lo que se devuelve y lo que está en DB hasta que el probe termine. | Especificar en Wave 4 exactamente qué campos del response cambian y cuáles se hardcodean vs se leen de DB. Proponer shape completo del 201 response post-Wave-4. |
| F8 | 🟢 BAJA | **GET /status: ownership check no detallado.** AC4/AC5 especifican auth con `x-agent-key del owner` pero no detallan cómo verificar que la key pertenece al owner del slug específico. El patrón en register usa `owner_id` de la key → `creator_profiles.id`. En GET /status habrá que hacer: (1) validar key → owner_id, (2) lookup agent por slug → creator_id, (3) verificar owner_id === creator_id. Dos queries extra. No es un blocker pero Wave 3 debe implementarlo correctamente o habrá IDOR. | Añadir en sección 4.5 (GET /status spec) el pseudocódigo de ownership check: hash key → owner_id, lookup agent.creator_id, verificar igualdad. Referencia HAL-003 / HAL-004. |

---

## Veredicto

### NECESITA CORRECCIÓN

**Blockers antes de Builder:**

1. **F1** — Definir destino de columnas legacy `last_health_check_ok` / `last_health_check_at`: DROP o sincronizar. Sin esta decisión la migración deja la DB en estado inconsistente.
2. **F2** — Resolver conflicto entre `status: 'active'` (JWT path actual) y `status: "reviewing"` (AC1). Sin esto Wave 4 tiene comportamiento indefinido para el path más privilegiado.
3. **F4** — Renombrar migración a `057_agents_health_check.sql` o documentar excepción a la convención con justificación.
4. **F5** — Unificar probe body (`{"ping":true}` vs `{"input":"ping"}`) antes de Wave 2.

**No blockers (documentar antes de merge):**
- F3: Anotar intencionalidad del double SSRF check en health-probe.ts
- F6: Actualizar `updateAgentHealth` si columnas legacy se mantienen
- F7: Detallar shape del 201 response en Wave 4
- F8: Añadir pseudocódigo de ownership check en GET /status spec
