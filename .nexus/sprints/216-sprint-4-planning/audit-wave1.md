# Audit Wave 1 — Sprint 4
> Auditor: Logic Auditor + Security Reviewer combinados (NexusAgil v1.3)
> Fecha: 2026-03-14
> Commits: `8a26b8b` (WAS-196) · `93cd8d1` (WAS-213) · `77cc218` (WAS-197)

---

## Audit — WAS-196 (commit `8a26b8b`)

### Logic Audit

#### AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|-------------|---------------|--------|
| AC1: GET /agents/:slug incluye `sandbox_enabled` | ✅ Sí | `src/app/api/v1/agents/[slug]/route.ts`:33,101 | ✅ OK |
| AC2: GET /agents (list) incluye `sandbox_enabled` | ✅ Sí (slim + full path) | `route.ts`:86,112,131,245 | ✅ OK |
| AC3: POST /sandbox/invoke retorna 403 si disabled | ⚠️ No tocado (ya implementado según SDD) | No en este commit | ✅ OK (fuera de scope) |
| AC4: Sandbox invoke funciona si enabled=true | ⚠️ No tocado (ya implementado según SDD) | No en este commit | ✅ OK (fuera de scope) |

**Nota AC3/AC4:** El SDD indica que la lógica de `sandbox/invoke` ya estaba implementada y los AC3/AC4 son tests de regresión. El commit no introduce cambios en esa ruta. No se observan tests de regresión nuevos en el diff — esto es un **MENOR** (los AC dicen "regresión test").

#### Findings Lógicos

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| L1 | MENOR | Default Safety | `sandbox_enabled: agent.sandbox_enabled ?? true` — fallback `true` es correcto (fail-safe). Coherente con SDD AC Critical Constraints. | `[slug]/route.ts`:101, `route.ts`:112, 245 |
| L2 | MENOR | Test Coverage | AC3/AC4 requieren "regresión test" explícito. No hay tests nuevos en el commit. Riesgo de regresión no cubierto. | N/A |
| L3 | INFO | Code Style | Alineación de `slim` con espacio extra (`slim        =`) — cosmético, no funcional. | `route.ts`:33 |

#### Veredicto Logic: **APROBADO** ✅
> AC1 y AC2 correctamente implementados. AC3/AC4 fuera de scope del commit (ya implementados). Finding MENOR de cobertura de test no bloquea.

---

### Security Review

#### Superficie de ataque

| Categoría | Nuevos elementos | Auth requerida | Status |
|-----------|-----------------|----------------|--------|
| GET /api/v1/agents | Campo `sandbox_enabled` en respuesta | No (endpoint público) | ✅ OK — campo no sensible |
| GET /api/v1/agents/:slug | Campo `sandbox_enabled` en respuesta | No (endpoint público) | ✅ OK — campo no sensible |
| GET /api/v1/agents?sandbox=true | Filtro existente, ya operativo | No | ✅ OK |
| GET /api/v1/agents?min_reputation | Nuevo filtro (WAS-213 bundled aquí) | No | ⚠️ ver WAS-213 |

#### Findings Seguridad

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| S1 | INFO | Exposición de datos | `sandbox_enabled` es metadata pública del agente — no dato sensible. Exponer en API pública es apropiado. | `route.ts`:112, 245 |
| S2 | LOW | Input Validation | El filtro `?sandbox=true` compara string exacto — correcto. El `?min_reputation` delega a WAS-213. | `route.ts`:34 |

#### Veredicto Security: **SEGURO** ✅

---

## Audit — WAS-213 (commit `93cd8d1`)

### Logic Audit

#### AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|-------------|---------------|--------|
| AC1: Migración 058 añade `performance_score NUMERIC(5,2) DEFAULT NULL` | ✅ Sí | `058_performance_score.sql`:3-5 | ✅ OK |
| AC2: Trigger recalcula `performance_score` en status terminal (success/error) + ≥5 calls | ✅ Parcial — ver F1 | `058_performance_score.sql`:19-45 | ❌ BLOQUEANTE |
| AC3: <5 calls → `performance_score` permanece NULL (no 0) | ✅ Condición heredada de `get_agent_percentile_metrics()` | `046_percentile_metrics.sql`:51-55 | ✅ OK |
| AC4: Atomicidad — trigger FOR EACH ROW | ✅ Sí | `058_performance_score.sql`:47-50 | ✅ OK |
| AC5: GET /agents?min_reputation filtra por `performance_score >= X` | ✅ Sí | `route.ts`:30,145-148 | ✅ OK |
| AC6: GET /agents/:slug incluye `performance_score` | ✅ Sí | `[slug]/route.ts`:36,91 | ✅ OK |
| AC7: Trigger con EXCEPTION WHEN OTHERS — no aborta invocación principal | ✅ Sí | `058_performance_score.sql`:38-41 | ✅ OK |
| AC8: Seed script → ≥5 agentes con `performance_score IS NOT NULL` | ✅ Sí (8 slugs demo) | `seed-performance-scores.ts`:12-20 | ✅ OK |

#### Findings Lógicos

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| F1 | **BLOQUEANTE** | Cálculo incorrecto | **BUG CRÍTICO DE FÓRMULA:** `get_agent_percentile_metrics()` devuelve `error_rate_7d` como **porcentaje 0–100** (ej: `5.00` = 5% de errores). El trigger usa `ROUND((1.0 - v_metrics.error_rate_7d) * 100.0, 1)` asumiendo que es una **ratio 0–1**. Con `error_rate_7d = 5.00`, el resultado es `(1.0 - 5.00) * 100 = -400`, que tras clamp queda en `0`. Con `error_rate_7d = 0.00` (0% errores), queda `100`. Casualmente los extremos son correctos, pero cualquier valor intermedio produce resultados totalmente erróneos. **Fórmula correcta:** `v_score := ROUND(100.0 - v_metrics.error_rate_7d, 1)` | `058_performance_score.sql`:32, `046_percentile_metrics.sql`:52 |
| F2 | MENOR | Validación input | `?min_reputation` en route.ts aplica `parseFloat()` pero no valida rango (acepta valores fuera de 0–100). Ejemplo: `?min_reputation=9999` ejecuta query válida devolviendo vacío sin error explícito. | `route.ts`:145-148 |
| F3 | MENOR | Naming consistency | El query param se llama `min_reputation` pero filtra `performance_score`. Los dos scores tienen semántica diferente (`reputation_score` = votos UP/DOWN, `performance_score` = error rate). El naming puede causar confusión API. SDD lo especifica así — es deuda de diseño. | `route.ts`:30, 145 |
| F4 | INFO | Seed script | `randomScore()` genera valores 75–99 con `Math.random() * 24`. Rango: `[75, 99)` — el valor `99.0` nunca se alcanza exactamente pero es aceptable para datos demo. | `seed-performance-scores.ts`:23 |
| F5 | MENOR | Error handling seed | El seed usa `console.warn` al fallar un slug (agente no existe en DB local) pero no retorna exit code no-cero. Si todos los slugs fallan, el script termina exitosamente. | `seed-performance-scores.ts`:35 |

#### Veredicto Logic: **REQUIERE CORRECCIÓN** ❌
> **Finding F1 es BLOQUEANTE.** El trigger produce `performance_score = 0` para todo agente con cualquier tasa de error entre 0% y 100% (excepto exactamente 0% y 100%). La fórmula debe corregirse antes de aplicar la migración.

**Fix requerido en `058_performance_score.sql` línea 32:**
```sql
-- INCORRECTO (actual):
v_score := ROUND((1.0 - v_metrics.error_rate_7d) * 100.0, 1);

-- CORRECTO:
v_score := ROUND(100.0 - v_metrics.error_rate_7d, 1);
```

---

### Security Review

#### Superficie de ataque

| Categoría | Nuevos elementos | Auth requerida | Status |
|-----------|-----------------|----------------|--------|
| Trigger SQL en agent_calls | `update_agent_performance_score()` SECURITY DEFINER | N/A (DB internal) | ⚠️ Ver S1 |
| GET /agents?min_reputation | Nuevo query param | No (endpoint público) | ✅ OK |
| scripts/seed-performance-scores.ts | Usa SERVICE_ROLE_KEY | Env vars locales | ✅ OK |

#### Findings Seguridad

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| S1 | MEDIUM | SECURITY DEFINER | La función `update_agent_performance_score()` es `SECURITY DEFINER`. Ejecuta `UPDATE agents SET performance_score = v_score WHERE id = NEW.agent_id`. El scope es correcto (solo actualiza performance_score del agente de la fila actual). Sin embargo, un bug en `get_agent_percentile_metrics()` podría provocar un write inesperado. Riesgo contenido pero SECURITY DEFINER siempre merece revisión explícita. | `058_performance_score.sql`:14 |
| S2 | LOW | Input Validation | `?min_reputation` acepta cualquier float sin validación de rango. No hay riesgo de inyección (usa `.gte()` de supabase-js que parametriza), pero podría devolver resultados inesperados. | `route.ts`:145-148 |
| S3 | INFO | Seed script keys | El seed requiere `SUPABASE_SERVICE_ROLE_KEY` en env. Correcto — no está hardcodeado. | `seed-performance-scores.ts`:7 |

#### Veredicto Security: **SEGURO** ✅
> Sin issues de auth/authz. SECURITY DEFINER bien acotado. Trigger no expone datos sensibles.

---

## Audit — WAS-197 (commit `77cc218`)

### Logic Audit

#### AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|-------------|---------------|--------|
| AC1: `npm install && npm run demo` completa sin errores | ⚠️ Parcial — ver F1 | `package.json` | ⚠️ MENOR |
| AC2: Output incluye `call_id`, `latency_ms`, `result` | ✅ Sí | `wasiai-tool.ts`:41-42 | ✅ OK |
| AC3: Directorio contiene `package.json`, `src/wasiai-tool.ts`, `src/index.ts`, `.env.example` | ✅ Sí (4/4 archivos) | Commit diff | ✅ OK |
| AC4: README tiene sección "## Quickstart" con ≤5 pasos | ✅ Sí (5 pasos exactos) | `README.md`:5-10 | ✅ OK |
| AC5: `wasiai-tool.ts` usa `ActionProvider` con `WasiAIAction` que llama `POST /api/v1/models/:slug/invoke` con `x-agent-key` | ✅ Sí | `wasiai-tool.ts`:9,27,30 | ✅ OK |
| AC6: Error 404/503 retorna mensaje descriptivo (no crash) | ✅ Sí | `wasiai-tool.ts`:36-38 | ✅ OK |
| AC7: `.env.example` documenta las 5 variables requeridas | ⚠️ Parcial — ver F2 | `.env.example` | MENOR |

#### Findings Lógicos

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| F1 | MENOR | Versión de dependencia | `@coinbase/agentkit-langchain` en `package.json` usa `0.3.0` mientras el SDD especifica `0.10.4`. La versión 0.3.x es anterior y puede no ser compatible con `@coinbase/agentkit: 0.10.4`. Riesgo real de `npm install` fallando o runtime errors. | `package.json`:10 |
| F2 | MENOR | AC7 discrepancia | El SDD AC7 especifica `CDP_API_KEY_NAME` y `CDP_API_KEY_PRIVATE_KEY` como variables requeridas, pero `.env.example` (correctamente para AgentKit 0.10.x) documenta `CDP_API_KEY_ID` y `CDP_API_KEY_SECRET`. La implementación es correcta pero el AC del SDD está desactualizado. | `.env.example`:12-13 |
| F3 | MENOR | `await` innecesario | `index.ts` usa `const tools = await getLangChainTools(agentkit)` — si `getLangChainTools` no es async, el `await` es harmless pero confuso. En 0.3.x es síncrono. | `src/index.ts`:16 |
| F4 | MENOR | Sin timeout en fetch | `fetch()` en `wasiai-tool.ts` no tiene timeout. Si el servidor WasiAI no responde, el agente cuelga indefinidamente. | `wasiai-tool.ts`:23 |
| F5 | INFO | `apiKey` vacío no advertido | Si `WASIAI_API_KEY` no está definido, `this.apiKey = ''` y la llamada se hace sin key. El error vendrá del servidor (401/403) pero no hay validación early-fail en constructor. | `wasiai-tool.ts`:14 |

#### Veredicto Logic: **APROBADO** ✅
> Todos los AC esenciales implementados. Los findings son MENORES — ninguno bloquea el funcionamiento del ejemplo. El potencial conflicto de versión (F1) merece verificación antes de demo día.

---

### Security Review

#### Superficie de ataque

| Categoría | Nuevos elementos | Auth requerida | Status |
|-----------|-----------------|----------------|--------|
| `wasiai-tool.ts` | Llamada externa a `${this.baseUrl}/api/v1/models/${args.slug}/invoke` | `x-agent-key` | ⚠️ Ver S1 |
| `.env.example` | Documenta API keys (no hardcoded) | N/A | ✅ OK |
| `index.ts` | Usa CDP + OpenAI keys de env | Env vars | ✅ OK |

#### Findings Seguridad

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| S1 | MEDIUM | Path Traversal | `args.slug` se interpola directamente en la URL: `` `${this.baseUrl}/api/v1/models/${args.slug}/invoke` ``. Si el LLM genera un slug malicioso como `../../admin` o `%2F..%2F..%2Fadmin`, podría dirigir la request a un endpoint no intencionado. Solución: validar `args.slug` con regex `/^[a-z0-9-]+$/` antes de usarlo en la URL. | `wasiai-tool.ts`:24 |
| S2 | LOW | API Key en memoria | `this.apiKey` se guarda en memoria de la instancia. En el contexto de un ejemplo local esto es aceptable. En producción, debería renovarse o usar un vault. | `wasiai-tool.ts`:14 |
| S3 | LOW | Sin validación de respuesta | `data.call_id` y `data.result` se incluyen en el return sin sanitizar. En el contexto de un ejemplo/tool para LLM, un valor inesperado podría manipular el contexto del agente (prompt injection indirecto). | `wasiai-tool.ts`:41-42 |
| S4 | INFO | `tsconfig.json` no en diff | El archivo `tsconfig.json` aparece en AC3 del SDD pero no está en el diff del commit 77cc218. Sin embargo, el commit `8a26b8b` stats muestra que `examples/agentkit-wasiai/tsconfig.json` fue añadido. Verificar que está presente. | `examples/agentkit-wasiai/tsconfig.json` |

#### Veredicto Security: **REQUIERE CORRECCIÓN** ⚠️
> S1 (path traversal) es MEDIUM y debe corregirse. El ejemplo está orientado a hackathon/demo pero el vector existe si se usa como base para producción. Recomendado agregar validación de slug antes de merge a main.

**Fix recomendado en `wasiai-tool.ts`:**
```typescript
// Antes del fetch, agregar:
if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(args.slug)) {
  return `WasiAI error: invalid slug format "${args.slug}"`
}
```

---

## Resumen Ejecutivo — Wave 1

| Issue | Commit | Veredicto Logic | Veredicto Security | Bloqueantes |
|-------|--------|----------------|--------------------|-------------|
| WAS-196 | `8a26b8b` | ✅ APROBADO | ✅ SEGURO | — |
| WAS-213 | `93cd8d1` | ❌ REQUIERE CORRECCIÓN | ✅ SEGURO | **F1: fórmula performance_score incorrecta** |
| WAS-197 | `77cc218` | ✅ APROBADO | ⚠️ REQUIERE CORRECCIÓN | — (S1 recomendado, no crítico en demo) |

### Acciones Requeridas antes de Wave 2

1. **[BLOQUEANTE] WAS-213 F1** — Corregir fórmula en `058_performance_score.sql`:
   ```sql
   -- Línea 32: cambiar
   v_score := ROUND((1.0 - v_metrics.error_rate_7d) * 100.0, 1);
   -- Por:
   v_score := ROUND(100.0 - v_metrics.error_rate_7d, 1);
   ```

2. **[RECOMENDADO] WAS-197 S1** — Agregar validación de slug en `wasiai-tool.ts` antes del fetch.

3. **[MENOR] WAS-197 F1** — Verificar compatibilidad `@coinbase/agentkit-langchain: 0.3.0` con `@coinbase/agentkit: 0.10.4`. Actualizar a `0.10.4` si incompatible.

4. **[MENOR] WAS-213 F2** — Agregar validación de rango para `?min_reputation` (0–100).
