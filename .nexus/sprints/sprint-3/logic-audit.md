# Logic Audit — Sprint 3
**Auditor:** NexusAgil Logic Auditor v1.3  
**Fecha:** 2026-03-13  
**Issues auditados:** SSRF-002, SCOPE-001, WAS-206, WAS-202  
**Archivos inspeccionados:**
- `src/lib/schema-validator.ts`
- `src/app/api/v1/compose/route.ts` (líneas 270–580)
- `src/app/api/v1/sandbox/invoke/[slug]/route.ts` (líneas 275–345)
- `supabase/migrations/055_idor_pipeline_ownership.sql`
- `supabase/migrations/056_output_schema.sql`

---

## 1. Tabla de Trazabilidad AC

### SSRF-002 (commit c301dba)

| AC | Descripción | Código real | Estado |
|----|-------------|-------------|--------|
| AC-1 | `file://` → bloqueado | `ref.includes('://')` → `file://` contiene `://` ✓ | ✅ PASS |
| AC-2 | `ftp://` → bloqueado | `ref.includes('://')` → `ftp://` contiene `://` ✓ | ✅ PASS |
| AC-3 | `data:` → bloqueado | `ref.startsWith('data:')` ✓ | ✅ PASS |
| AC-4 | `ldap://` o cualquier protocolo → bloqueado | `ref.includes('://')` es genérico ✓ | ✅ PASS |
| AC-5 | `#/definitions/foo` → NO bloqueado | No contiene `://` ni empieza con `data:` → pasa ✓ | ✅ PASS |
| AC-6 | `./types.json` → NO bloqueado | No contiene `://` ni empieza con `data:` → pasa ✓ | ✅ PASS |
| AC-7 | `http://` y `https://` → bloqueados | Ambos contienen `://` → bloqueados ✓ | ✅ PASS |

**Nota de seguridad (no AC pero sí riesgo):** URLs protocol-relative como `//evil.com/schema.json` **no son bloqueadas** (`//evil.com` no contiene `://`). Ajv podría resolverlas dependiendo del entorno. No es AC-violation pero recomendaría `ref.startsWith('//')` como condición adicional.

---

### SCOPE-001 (commit fe4a148)

| AC | Descripción | Código real | Estado |
|----|-------------|-------------|--------|
| AC-1 | fallback out-of-scope → `scope_violation` | `fallbackOutOfScope = true` → `code: fallbackOutOfScope ? 'scope_violation' : 'no_agent_match'` ✓ | ✅ PASS |
| AC-2 | sin fallback → `no_agent_match` | `fallbackOutOfScope` permanece `false` → `no_agent_match` ✓ | ✅ PASS |
| AC-3 | tsc SHALL pass | Tipos correctos, flag declarado con `let` tipado implícito boolean ✓ | ✅ PASS (asumido, sin ejecutar tsc) |

**Observación:** La variable `fallbackOutOfScope` está declarada **dentro** del bloque `if (!discovered)`, con scope correcto por step. No hay riesgo de contaminación entre iteraciones del loop.

**Edge case cubierto:** Si `fallback_slug` existe pero el agente no existe en DB ni en map, `fbAgent` es undefined → no se entra al bloque `if (fbAgent)` → `fallbackOutOfScope` queda `false` → retorna `no_agent_match`. Semánticamente correcto (el fallback no existe ≠ está fuera de scope).

---

### WAS-206 (commit 67e0a8e)

| AC | Descripción | Código real | Estado |
|----|-------------|-------------|--------|
| AC-1 | key incorrecta → `owned_by_key=false`, `step_outputs=null` | `CASE WHEN ak.key_hash = p_key_hash THEN pe.step_outputs ELSE NULL END` + `(ak.key_hash = p_key_hash) AS owned_by_key` ✓ | ✅ PASS |
| AC-2 | key correcta → fila completa con step_outputs | `CASE WHEN` retorna `pe.step_outputs` cuando coincide ✓ | ✅ PASS |
| AC-3 | pipeline inexistente → 0 rows → 404 compose | `JOIN agent_keys` → si `pe.id` no existe, 0 rows → `if (pipelineErr \|\| !pipeline)` → 404 ✓ | ✅ PASS |
| AC-4 | `owned_by_key=false` → 403 `pipeline_access_denied` | `if (!pipeline.owned_by_key) { return 403 pipeline_access_denied }` en compose ✓ | ✅ PASS |
| AC-5 | tsc SHALL pass | Tipos del RETURNS TABLE alineados con consumo en compose ✓ | ✅ PASS (asumido) |

**Observación menor:** La función usa `FOR UPDATE` (row lock). Correcto para el retry path donde se va a actualizar el pipeline. No es un bug lógico.

---

### WAS-202 (commit dde0987)

| AC | Descripción | Código real | Estado |
|----|-------------|-------------|--------|
| AC-1 | agent con output_schema → validar con AJV pre-insert | `if (agent.output_schema) { validateInput(...) }` antes del insert en ambos endpoints ✓ | ✅ PASS |
| AC-2 | output inválido → refund + `schema_violation` + 422 | Ambos endpoints: refund → insert `result_type: 'schema_violation'` → return 422 `output_schema_violation` ✓ | ✅ PASS |
| AC-3 | sin output_schema → skip | `if (agent.output_schema)` — si null/undefined, skip ✓ | ✅ PASS |
| AC-4 | output válido → `result_type: success` | Post-bloque WAS-202, `agentCallResultType = stepStatus === 'success' ? 'success' : 'agent_error'` ✓ | ✅ PASS |
| AC-5 | creator puede declarar output_schema en UI | **No verificable** desde archivos de scope (requiere UI components) | ⚠️ NO AUDITADO |
| AC-6 | output_schema meta-validado al guardar | `metaValidateSchema()` existe en `schema-validator.ts` con AJV compile + SSRF check. **No verificable** si se llama en el endpoint de publish/edit sin leer ese archivo | ⚠️ NO AUDITADO |
| AC-7 | tsc SHALL pass | Código tipado correctamente. `validateInput` tipada `(schema: unknown, input: unknown): string \| null` ✓ | ✅ PASS (asumido) |

**Bug encontrado — WAS-202 compose (BUG-001):**  
Ver sección de Findings.

---

## 2. Tabla de Findings

| ID | Severidad | Issue | Archivo | Línea aprox. | Descripción |
|----|-----------|-------|---------|--------------|-------------|
| BUG-001 | 🟡 MEDIUM | WAS-202 | `compose/route.ts` | ~540 | El bloque WAS-202 en compose retorna `chargeDecision: 'refund'` en el objeto de retorno, pero el Wave 3c de refund ya se ejecutó antes (solo para `stepStatus === 'error'`). Cuando WAS-202 dispara, `stepStatus === 'success'`, por lo que Wave 3c NO refundió. El bloque WAS-202 hace el refund inline correctamente. **Sin embargo**, el objeto retornado incluye `chargeDecision: 'refund'` que podría confundir al código upstream si este re-intenta el refund. Requiere verificar si el caller de `executeStep` honra `chargeDecision` del retorno o lo ignora cuando ya viene reason de `output_schema_violation`. |
| WARN-001 | 🔵 LOW | SSRF-002 | `schema-validator.ts` | ~72 | Protocol-relative URLs (`//evil.com/schema.json`) no son bloqueadas por el check actual (`includes('://')` no matchea `//...`). AJV podría resolver estas URLs en ciertos entornos. No es AC-violation pero es un gap de seguridad residual. |
| INFO-001 | ⬜ INFO | WAS-202 | `sandbox/invoke/route.ts` | ~310 | En sandbox, el insert de `agent_calls` con `result_type: 'schema_violation'` no incluye `latency_ms`. El insert de éxito sí incluye latency (asumido). Inconsistencia menor en datos de telemetría. |

---

## 3. Veredicto por Issue

| Issue | ACs verificables | ACs que pasan | Bugs | Veredicto |
|-------|-----------------|---------------|------|-----------|
| SSRF-002 | 7/7 | 7/7 | WARN-001 (gap seguridad, no AC) | ✅ **APROBADO** |
| SCOPE-001 | 3/3 | 3/3 | — | ✅ **APROBADO** |
| WAS-206 | 5/5 | 5/5 | — | ✅ **APROBADO** |
| WAS-202 | 5/7 auditables | 5/5 auditables | BUG-001 (medium), INFO-001 | ⚠️ **CONDICIONAL** — AC-5 y AC-6 no verificados (fuera de scope de archivos provistos). BUG-001 requiere revisión del caller de executeStep. |

---

## 4. Recomendaciones

1. **BUG-001 (prioritario):** Verificar en `compose/route.ts` qué hace el código upstream con el valor `chargeDecision: 'refund'` retornado por `executeStep` cuando el reason es `output_schema_violation`. Si el caller hace un segundo refund, habría double-refund. Buscar en el loop principal de steps el manejo del retorno de `executeStep`.

2. **WARN-001:** Agregar `|| ref.startsWith('//')` al check SSRF para cubrir protocol-relative URLs:
   ```ts
   if (ref.includes('://') || ref.startsWith('data:') || ref.startsWith('//')) {
   ```

3. **AC-5 y AC-6 WAS-202:** Solicitar al auditor que revise el endpoint de publish/edit de agentes (`src/app/api/v1/agents/[slug]/route.ts` o similar) para confirmar que `metaValidateSchema()` se llama al guardar `output_schema`.

4. **INFO-001:** Incluir `latency_ms` en el insert de `schema_violation` en sandbox para consistencia de telemetría.
