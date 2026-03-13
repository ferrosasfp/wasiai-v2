# Security Review — Sprint 2 WasiAI

**Revisor:** Security Reviewer (subagente NexusAgile v1.3)
**Fecha:** 2026-03-13
**Rama:** Sprint 2 — WAS-186, WAS-196, WAS-200, WAS-204

---

## Hallazgos

| # | Área | Severidad | CVE-like | Descripción | Recomendación |
|---|------|-----------|----------|-------------|---------------|
| 1 | WAS-200 SSRF | MEDIUM | SSRF-001 | `findExternalRefs` bloquea `http://` y `https://` en `$ref`, pero **no bloquea `$schema` con URL externa**. AJV no hace fetch por defecto, pero si en el futuro se habilita `loadSchema`, se abre vector SSRF real. | Agregar check explícito: `if (key === '$schema' && typeof val === 'string' && (val.startsWith('http://') \|\| val.startsWith('https://'))) return error`. |
| 2 | WAS-200 SSRF | LOW | SSRF-002 | `file://` y otros esquemas (`ftp://`, `data:`) no están bloqueados en `$ref`. AJV actualmente no los resuelve, pero es un gap de defensa en profundidad. | Cambiar el check a allowlist: solo permitir refs que empiecen con `#` (refs locales). Rechazar cualquier otra cosa que contenga `://`. |
| 3 | WAS-204 Ownership | MEDIUM | IDOR-001 | `get_pipeline_for_retry` retorna `step_outputs` y todos los datos del pipeline **sin importar si `owned_by_key = false`**. El check de ownership ocurre **en el cliente** (compose.ts línea ~220). Si hay un bug en el cliente, habría data leakage de pipelines ajenos. | Mover el ownership check al lado de la DB: `WHERE pe.id = p_pipeline_id AND ak.key_hash = p_key_hash`. Retornar 0 rows si no hay match en lugar de devolver datos y calcular un bool. |
| 4 | WAS-186 Scope | MEDIUM | SCOPE-001 | **`fallback_slug` no tiene scope check explícito.** En `compose/route.ts` cuando un discovery falla y se usa `fallback_slug`, el código busca el agente en `agentMap` sin llamar a `isAgentInScope`. Prácticamente es seguro porque `agentMap` solo contiene agentes que ya pasaron el scope check de sus propios steps, pero el path de código es frágil y no tiene defensa explícita. | Agregar scope check explícito antes de usar `fallback_slug`: `if (!isAgentInScope(fbAgent.slug, fbAgent.category, keyRow.allowed_slugs, keyRow.allowed_categories)) return 403`. |
| 5 | WAS-196 Sandbox | LOW | BYPASS-001 | El check `agent.sandbox_enabled === false` usa strict equality. Si la columna `sandbox_enabled` es nullable y el valor es `NULL`, la condición es `null === false` → `false`, lo que **permite sandbox en agentes con null**. | Cambiar a `if (!agent.sandbox_enabled)` o asegurar constraint `NOT NULL DEFAULT false` en la columna. |
| 6 | DB — Migration 052 | PASS | — | `get_pipeline_for_retry` y `append_step_output`: ambas tienen `SECURITY DEFINER + SET search_path = public`, GRANTs solo a `service_role`, REVOKE de PUBLIC. Sin riesgo de SQL injection (parámetros tipados: UUID + TEXT). | Sin acción requerida. |
| 7 | DB — Migration 053 | PASS | — | Solo DDL (ALTER TABLE + CREATE INDEX). No RPCs, no SECURITY DEFINER necesario. Índices GIN condicionales correctamente scoped. | Sin acción requerida. |
| 8 | WAS-204 Race Condition | PASS | — | `SELECT FOR UPDATE` en `get_pipeline_for_retry` previene correctamente retries concurrentes sobre el mismo pipeline. La transacción lockea la fila hasta que el caller confirma o abandona. | Sin acción requerida. |
| 9 | WAS-186 Discovery | PASS | — | `discoverAgent` recibe `allowed_slugs` y `allowed_categories` como parámetros y los aplica en el query. El scope se filtra en DB, no solo en compose. | Sin acción requerida. |
| 10 | WAS-196 Orden de checks | PASS | — | `sandbox_enabled === false` se verifica **antes** del balance check (paso 3 vs paso 4-6). No hay timing attack posible. | Sin acción requerida. |

---

## Detalle técnico por área

### WAS-200 — `findExternalRefs` analysis

```
✅ Recursivo: sí — itera Arrays y Objects en depth-first
✅ Cubre $ref en definitions/properties/if/then/else: sí — itera TODOS los keys
✅ Cubre $ref anidados: sí
⚠️  NO cubre $schema con URL externa (hallazgo #1)
⚠️  NO cubre file:// en $ref (hallazgo #2)
```

### WAS-204 — `get_pipeline_for_retry` analysis

```sql
-- El problema: retorna datos aunque owned_by_key = false
RETURN QUERY
SELECT pe.id, pe.status, pe.step_outputs,
       (ak.key_hash = p_key_hash) AS owned_by_key  -- bool calculado
FROM pipeline_executions pe
JOIN agent_keys ak ON ak.id = pe.key_id
WHERE pe.id = p_pipeline_id  -- ← SIN filtro de ownership aquí
FOR UPDATE;
```

La solución: `WHERE pe.id = p_pipeline_id AND ak.key_hash = p_key_hash`. Retornar 0 rows = no autorizado. No exponer datos del pipeline antes de confirmar ownership.

### WAS-186 — Fallback slug path

```typescript
if (step.fallback_slug) {
  const fbAgent = agentMap.get(step.fallback_slug)
  if (fbAgent) {
    steps[i] = { ...step, agent_slug: step.fallback_slug }
    resolvedSlugs.set(i, step.fallback_slug)
    continue  // ← NO hay isAgentInScope() aquí
  }
}
```

Exploit teórico bloqueado naturalmente: `agentMap` solo tiene agentes cargados desde `staticSlugs` que ya pasaron scope check. Pero el código no documenta esta invariante y es frágil ante futuros refactors.

### WAS-196 — Orden de checks (correcto)

```
Step 1: Auth
Step 2: Rate limit
Step 3: Fetch agent + status check
Step 3b: sandbox_enabled check  ← AQUÍ (antes de balance)
Step 4-6: Balance check y deducción
```

---

## Veredicto

### ✅ PASS — con observaciones MEDIUM

No se encontraron vulnerabilidades **CRITICAL** (explotables sin auth) ni **HIGH** (explotables con cuenta válida con impacto directo).

**Hallazgos bloqueantes:** Ninguno.

**Hallazgos MEDIUM que deben ser corregidos antes de GA:**
- `#3 IDOR-001` — ownership check client-side en RPC (risk superficie de data leakage)
- `#4 SCOPE-001` — fallback_slug sin scope check explícito (frágil ante refactors)
- `#1 SSRF-001` — $schema URL no bloqueado (precaución para evolución futura de AJV config)

**Hallazgos LOW para próximo sprint:**
- `#2 SSRF-002` — allowlist de esquemas en $ref
- `#5 BYPASS-001` — null strict equality en sandbox_enabled

---

*Generado por: subagente security-reviewer | NexusAgile v1.3 | Sprint 2*
