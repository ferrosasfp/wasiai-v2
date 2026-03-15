# Requirements Review — Sprint 4
> Fecha: 2026-03-14 | Reviewer: San (NexusAgil v1.3) | Metodología: RR-checklist v1.3

---

## WAS-213 — reputation_score null

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | CONCEPTO | 🔴 Critical | `get_agent_percentile_metrics` retorna `p50_latency_ms`, `p95_latency_ms`, `error_rate_7d`, `error_rate_sample` — **no retorna un reputation_score**. El AC1 asume que esa función produce un score, pero no hay fórmula definida para convertir latencia/error_rate → score numérico. Los ACs son inimplementables tal como están. | AC1 REDEFINIDO: "WHEN invocación completa, THE system SHALL calcular `reputation_score` como `ROUND(100 - error_rate_7d, 1)` (o fórmula documentada) usando `get_agent_percentile_metrics(agent_id)` y actualizar `agents.reputation_score`. IF error_rate_7d IS NULL (< 5 calls), THE score SHALL permanecer NULL." |
| 2 | CONFLICTO | 🔴 Critical | `reputation_score` ya existe y es mantenido por `trg_update_agent_reputation` (migración 0011) basado en **votos UP/DOWN** de `agent_ratings` (escala 0–100). El WAS-213 propone una segunda fuente (invocaciones). No está definido si: (a) reemplaza el sistema de votos, (b) coexiste como campo separado, (c) se promedia. Implementar el trigger de invocaciones destruiría silenciosamente la reputación por votos. | Definir explícitamente: ¿`reputation_score` = votos OR performance OR composite? Si es composite, agregar campo `performance_score NUMERIC(5,2)` separado. |
| 3 | ESCALA | 🟠 High | AC2 testea `?min_reputation=0.5` (escala 0–1) pero `reputation_score` en DB es `NUMERIC(5,2)` con trigger que escribe 0–100. El filtro `gte('reputation_score', 0.5)` retornaría todos los agentes con score >= 0.5 (prácticamente todos), no los top 50%. | Definir escala consistente (0–1 ó 0–100) o añadir AC: "WHEN `min_reputation` recibido en rango 0–1, THE endpoint SHALL multiplicar por 100 antes de filtrar." |
| 4 | GAP | 🟠 High | `GET /api/v1/agents` (route.ts) no soporta el query param `?min_reputation`. Solo existe en `agent-discovery.ts` (usado por compose/MCP). El AC2 requiere que el endpoint REST público lo soporte — no está implementado. | AC2 complementar: "WHEN `GET /api/v1/agents?min_reputation=X`, THE route.ts SHALL leer el param y aplicar `.gte('reputation_score', X)` en la query." |
| 5 | AC QUALITY | 🟡 Medium | AC3 habla de "seed script" pero el Scope IN no lo menciona explícitamente. No hay criterio de aceptación para verificar que el script fue ejecutado. | AC3 mejorado: "WHEN seed script ejecutado en entorno demo, THE query `SELECT COUNT(*) FROM agents WHERE reputation_score IS NOT NULL` SHALL retornar >= 5 agentes." |
| 6 | EDGE CASE | 🟡 Medium | No hay AC para el caso de **concurrencia**: dos invocaciones completando simultáneamente para el mismo agente pueden causar race condition en el UPDATE de `reputation_score`. | AC nuevo: "WHEN dos invocaciones completan simultáneamente, THE update SHALL usar `UPDATE ... WHERE id = $1` atómico (no RMW) para evitar race condition." |
| 7 | SCOPE | 🟡 Medium | Scope OUT no menciona el endpoint `/api/v1/agents/[slug]/reputation` que ya existe en el repo. ¿Este endpoint se ve afectado? | Agregar al Scope OUT: "endpoint `/api/v1/agents/[slug]/reputation` — sin cambios en Sprint 4." |

**Veredicto: NECESITA CAMBIOS** — bloqueado por #1 y #2 (conflicto conceptual con trigger existente + fórmula sin definir)

---

## WAS-197 — AgentKit + WasiAI

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | CONTRADICCIÓN | 🔴 Critical | AC1 dice "sin Agent Key, x402 payment flow on-chain Avalanche C-Chain". Pero el README.md completo usa `WASIAI_API_KEY` (agent key con budget). Los dos flujos son mutuamente excluyentes. El ejemplo NO implementa x402 directo. | Elegir uno: (A) El ejemplo usa Agent Key con budget (actual en README) — actualizar AC1 a "WHEN AgentKit agent tiene WASIAI_API_KEY configurada, THE invocación SHALL completarse via budget pre-fondeado"; o (B) Implementar x402 real sin key. |
| 2 | IMPLEMENTACIÓN FALTANTE | 🔴 Critical | `examples/agentkit-wasiai/` solo contiene `README.md`. No hay código ejecutable: sin `package.json`, sin `src/wasiai-provider.ts`, sin script de demo. AC5 dice "código SHALL estar" — actualmente solo hay snippets en Markdown. | AC5 extendido: "WHEN `ls examples/agentkit-wasiai/`, THE directorio SHALL contener: `package.json`, `src/wasiai-provider.ts`, `src/index.ts` (demo script), `.env.example`." |
| 3 | TESTABILITY | 🟠 High | AC3: "output SHALL mostrar tx hash, latencia, resultado". Si el flujo usa Agent Key (no x402), no hay `tx_hash` en la respuesta — solo `call_id`. Testear AC3 es imposible con el diseño actual. | Si se mantiene Agent Key: AC3 = "output SHALL mostrar: `call_id`, `latencia_ms`, `resultado`, `balance_restante`". |
| 4 | SETUP | 🟡 Medium | AC4: "instrucciones de setup en <5 pasos". El README tiene más de 5 pasos (npm create, cd, npm install, .env, registrar identity). Testeable pero borderline. | Consolidar en un bloque `## Quickstart (5 pasos)` explícito. |
| 5 | DEPENDENCIA | 🟡 Medium | El ejemplo referencia `/api/v1/models/${slug}/invoke` (ruta antigua) en lugar de `/api/v1/agents/${slug}/invoke`. En producción ambas existen, pero la canónica es `/agents/`. | Actualizar ejemplo a `/api/v1/agents/${slug}/invoke` para consistencia con Sprint 4. |
| 6 | SCOPE | 🟡 Medium | Scope OUT dice "sin cambios en endpoint WasiAI" pero AC1 original requeriría x402 que SÍ requiere cambios en el endpoint (agregar soporte x402 sin key). Contradicción si AC1 no se corrige. | Si se elige Agent Key: Scope OUT queda correcto. Si se elige x402: mover a Sprint 5 como feature separada. |

**Veredicto: NECESITA CAMBIOS** — bloqueado por #1 (contradicción x402 vs Agent Key) y #2 (código ejecutable faltante)

---

## WAS-186 — Agent Key Scoping

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | GAP CRÍTICO | 🔴 Critical | AC4: "key con scope invoca agente fuera de scope → 403 `agent_not_in_scope`". El endpoint principal `/api/v1/models/[slug]/invoke` **NO tiene scope check** (grep sin resultados para `isAgentInScope` en ese archivo). Solo `compose/route.ts` aplica scope. Invocación directa con key scoped bypasea el scope completamente. | AC4 extendido: "WHEN `POST /api/v1/models/[slug]/invoke` con key scoped fuera de scope, THE endpoint SHALL llamar `isAgentInScope()` ANTES del payment check y retornar 403 `agent_not_in_scope`." |
| 2 | SCOPE PARCIAL | 🟠 High | El scope check en `compose/route.ts` retorna `error: 'Agent not in key scope', code: 'scope_violation'` — pero el AC4 especifica `error: "agent_not_in_scope"`. El código y el AC no coinciden en el error code. | Unificar: `code: "agent_not_in_scope"` en todos los endpoints que aplican scope check. |
| 3 | EDGE CASE | 🟡 Medium | No hay AC para `allowed_slugs = []` (array vacío vs null). Array vacío es distinto de NULL pero ambos deberían comportarse como "sin acceso total"? La lógica en `isAgentInScope` trata `[]` como falsy si se comprueba con `!allowedSlugs` — en JS `![]` es false, por lo que `[]` habilitaría acceso total por lógica incorrecta. | AC nuevo: "WHEN `allowed_slugs = []` (empty array), THE sistema SHALL tratarlo como sin acceso a ningún slug (NOT como null/sin restricción)." |
| 4 | AC QUALITY | 🟡 Medium | AC2: "slugs inexistentes retornan 422" — ¿en qué momento? ¿Al crear la key? ¿Al invocar? Los ACs no distinguen creación vs uso. El service (agent-keys.service.ts) valida al crear, pero no hay AC explícito para el flujo de invocación. | Clarificar: "WHEN se **crea** key con `allowed_slugs` que contiene slugs no existentes, THE endpoint SHALL retornar 422. WHEN se **invoca** con key scoped a slug renombrado/eliminado, THE endpoint SHALL retornar 403 `agent_not_in_scope`." |
| 5 | DEPENDENCIA | 🟡 Medium | AC4 depende del endpoint `invoke` que no está en Scope IN de WAS-186. Si el dev de WAS-186 no toca el invoke endpoint, el AC no se cumple. | Agregar al Scope IN: "modificación del middleware de validación en `/api/v1/models/[slug]/invoke/route.ts`." |

**Veredicto: NECESITA CAMBIOS** — bloqueado por #1 (scope bypass en invoke directo)

---

## WAS-196 — Sandbox opt-in/out

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | GAP | 🟠 High | AC5: "GET /api/v1/agents/:slug SHALL incluir `sandbox_enabled`". El cuerpo de respuesta en `src/app/api/v1/agents/[slug]/route.ts` **no incluye `sandbox_enabled`** — el campo no está en el SELECT ni en el objeto de respuesta. | AC5 extendido: incluir `sandbox_enabled` en el SELECT y en el objeto de respuesta. Verificable: `curl /api/v1/agents/{slug} | jq .sandbox_enabled` no debe ser `undefined`. |
| 2 | GAP | 🟡 Medium | `GET /api/v1/agents` (list) tampoco expone `sandbox_enabled` en la respuesta de cada agente — solo el filtro `?sandbox=true` está implementado. Un cliente que quiera saber si el sandbox está habilitado en el resultado de discovery no puede saberlo. | AC nuevo: "WHEN `GET /api/v1/agents`, THE response de cada agente SHALL incluir `sandbox_enabled: boolean`." |
| 3 | EDGE CASE | 🟡 Medium | NULL check en sandbox endpoint: el código usa `!== true` (BYPASS-001) que deniega NULL. Correcto para seguridad, pero no documentado en ACs. Si la migración falla y la columna queda NULL en algunos rows, todos quedan denegados silenciosamente. | AC de regresión: "WHEN `sandbox_enabled IS NULL` (migración parcial), THE endpoint SHALL retornar 403 (fail-safe)." + doc en Scope IN de la migración. |
| 4 | AC QUALITY | 🟡 Medium | AC2: "UI SHALL mostrar checkbox con nota de costos" — no testeable técnicamente sin E2E tests o screenshot. Tampoco hay criterio de qué texto debe tener la nota. | AC2 mejorado: "WHEN creador visita `/agents/{slug}/edit`, THE página SHALL renderizar `<input type='checkbox' name='sandbox_enabled'>` con label que incluya el texto 'infrastructure costs'." (testeable con Playwright) |

**Veredicto: NECESITA CAMBIOS** — AC5 no implementado; sin esos cambios la API pública es incompleta

---

## WAS-200 — Input Schema + Validación pre-cobro

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | MIGRACIÓN INCORRECTA | 🟠 High | AC1 referencia "migration 055" para `input_schema JSONB`. El archivo 055 en el repo es `055_idor_pipeline_ownership.sql` (fix IDOR de WAS-206). La migración correcta es **054_input_schema.sql**. Si el dev busca migration 055 para hacer el trabajo, encontrará código IDOR, no input_schema. | Corregir AC1: "WHEN migration **054** aplicada, `agents` SHALL tener `input_schema JSONB nullable`." |
| 2 | GAP CRÍTICO | 🔴 Critical | AC4: validación pre-cobro en `POST /api/v1/agents/:slug/invoke` (main invoke). El archivo `src/app/api/v1/models/[slug]/invoke/route.ts` **no importa ni usa `validateInput`**. Solo el sandbox endpoint lo implementa. Las invocaciones reales (pagadas con x402 o agent key) no validan el input antes de cobrar. | AC4 extendido: "WHEN `POST /api/v1/models/[slug]/invoke` con input y `input_schema` definido, THE endpoint SHALL llamar `validateInput(schema, input)` ANTES de cobrar. Input inválido SHALL retornar 422 sin ejecutar payment settlement." |
| 3 | SSRF | 🟡 Medium | AC3 especifica solo bloquear `$ref` con URL http/https. La implementación actual también bloquea `$schema`, URLs con `data:` y `//`. El AC es más restrictivo que el código — lo cual es bueno, pero el AC debería reflejar la implementación real para evitar que alguien "cumpla el AC" eliminando la protección extra. | AC3 ampliado: "SHALL rechazar schemas que contengan `$ref` o `$schema` con URLs externas (`://`, `data:`, `//`)." |
| 4 | AC QUALITY | 🟡 Medium | AC2: "meta-validar que es JSON Schema draft-07 válido". Draft-07 es específico, pero AJV por defecto valida draft-07 con `strict: false`. No hay AC para verificar que el schema usa `$schema: "http://json-schema.org/draft-07/schema#"`. Un schema draft-04 podría pasar. | Agregar: si se requiere draft-07 estrictamente, el AC debe especificar: "WHEN schema no incluye `$schema` apuntando a draft-07, THE sistema SHALL aceptarlo de todas formas (backward compatible)." o rechazarlo — definir explícitamente. |
| 5 | EDGE CASE | 🟡 Medium | No hay AC para schemas circulares o con profundidad excesiva (`$ref` a sí mismo), que pueden causar stack overflow en AJV al compilar. | AC nuevo: "WHEN schema tiene recursión circular (`$ref` apuntando al mismo schema), THE `metaValidateSchema` SHALL retornar error de validación (no crash)." |

**Veredicto: NECESITA CAMBIOS** — bloqueado por #2 (invoke principal sin validación) y #1 (migración incorrecta en ACs)

---

## Resumen Sprint

| Issue | Veredicto | Blockers | Riesgo si se entrega sin corregir |
|-------|-----------|----------|-----------------------------------|
| WAS-213 | ❌ NECESITA CAMBIOS | Conflicto con trigger de votos existente, fórmula sin definir, escala inconsistente | Destruye reputación por votos al aplicar trigger de invocaciones |
| WAS-197 | ❌ NECESITA CAMBIOS | Contradicción x402-vs-AgentKey en AC1, código ejecutable faltante | Demo del hackathon indemostrable; jueces no pueden ejecutar el ejemplo |
| WAS-186 | ❌ NECESITA CAMBIOS | Scope bypass en invoke directo no bloqueado | Security issue: key con scope puede invocar cualquier agente via `/models/:slug/invoke` |
| WAS-196 | ⚠️ NECESITA CAMBIOS | `sandbox_enabled` no expuesto en GET /agents/:slug | Clientes API no pueden descubrir si sandbox está activo |
| WAS-200 | ❌ NECESITA CAMBIOS | Invoke principal sin validación pre-cobro, número de migración incorrecto en ACs | Usuarios cobrados por input inválido en flujo x402/agent-key |

---

## Conflictos entre issues

| Conflicto | Issues | Detalle | Recomendación |
|-----------|--------|---------|---------------|
| **invoke/route.ts** | WAS-186 + WAS-200 | Ambos requieren modificar `src/app/api/v1/models/[slug]/invoke/route.ts`: WAS-186 agrega scope check, WAS-200 agrega input validation. Si se trabajan en ramas separadas, habrá merge conflict en el mismo archivo. | Asignar ambos al mismo dev o coordinar un task order: 1º WAS-186 (scope check al top del handler), 2º WAS-200 (validateInput después del scope check, antes del payment). |
| **reputation_score column** | WAS-213 + 0011_agent_ratings | WAS-213 propone actualizar `reputation_score` desde `agent_calls`, pero `trg_update_agent_reputation` ya lo actualiza desde `agent_ratings`. Un trigger de invocaciones que escriba al mismo campo causará que votos y performance se sobreescriban mutuamente en carrera. | Resolver conceptualmente antes de codear: ¿un campo o dos? Si dos campos, WAS-213 debe crear `performance_score NUMERIC(5,2)` y no tocar `reputation_score`. |
| **examples/agentkit-wasiai/** | WAS-197 | Solo README, sin código. El directorio `agentkit-demo/` también existe en examples/ y puede confundir sobre cuál es el ejemplo canónico. | Definir en Scope IN cuál directorio es el entregable oficial para el hackathon. |
| **Migration numbering** | WAS-200 | AC menciona migration 055 pero 055 ya existe (IDOR fix). Usar 057 o el siguiente disponible para evitar conflictos con prod. | Verificar el número correcto antes de crear nueva migración: `ls supabase/migrations/ | tail -5` |
