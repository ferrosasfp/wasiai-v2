# Requirements Review — Sprint 3
**Reviewer:** NexusAgil Requirements Reviewer v1.3
**Fecha:** 2026-03-13
**Issues revisados:** WAS-206, WAS-202, WAS-198, SSRF-002, SCOPE-001

---

## WAS-206 — IDOR-001: get_pipeline_for_retry ownership fix

### Veredicto: 🔴 NECESITA CAMBIOS

### Findings

| # | Área | Hallazgo | Severidad |
|---|------|----------|-----------|
| F1 | Scope / Implementación | La migración 052 (ya en producción) **contiene el mismo código vulnerable** que se pide corregir. WAS-206 necesita una migración nueva (ej. 053_idor_fix.sql) que reemplace la función. Los ACs no mencionan esto. | BLOQUEANTE |
| F2 | Cobertura de paths | No hay AC para `pipeline_id` inexistente vs `pipeline_id` existente pero de otro key. Con el fix, ambos casos retornan 0 rows — el AC-2 los fusiona pero el código en `route.ts` tiene dos respuestas distintas (`pipeline_not_resumable` vs `pipeline_access_denied`). Hay una contradicción. | ALTA |
| F3 | Calidad de ACs | El AC-3 garantiza que "el retry flow existente sigue funcionando", pero si el IDOR se elimina, la columna `owned_by_key` desaparece del resultado (WHERE filtra en lugar de retornar BOOLEAN). La lógica en `route.ts` línea 346 que chequea `pipeline.owned_by_key` se convierte en código muerto — o hay que quitarla o rediseñar la firma de retorno. AC-3 no cubre este cambio de contrato. | ALTA |
| F4 | Cobertura de paths | Sin AC para concurrencia: dos requests simultáneos de retry del mismo pipeline por el mismo key. El `FOR UPDATE` debe mantenerse, pero no está explicitado en los ACs. | MEDIA |
| F5 | Calidad de ACs | Sin AC para el caso `p_pipeline_id` con formato inválido (UUID malformado). ¿La RPC debe retornar 0 rows o error? | BAJA |
| F6 | Dependencias | No menciona la dependencia con la migración 052 (que define la función a reemplazar). El número de nueva migración debe ser acordado para evitar colisiones. | MEDIA |

### ACs faltantes sugeridos
- **AC-4:** WHEN WAS-206 fix is deployed, THEN a new migration SHALL replace the function in migration 052 (IDOR version)
- **AC-5:** WHEN `p_pipeline_id` does not exist, THEN RPC SHALL return 0 rows (same as wrong key — no differentiation at DB level)
- **AC-6:** WHEN the fix is applied, THEN `owned_by_key` column SHALL be removed from RETURNS TABLE; consuming code SHALL remove the `owned_by_key` check
- **AC-7:** WHEN two concurrent retries arrive for the same pipeline, THEN `FOR UPDATE` SHALL prevent double-execution (lock behavior documented)

---

## WAS-202 — Output schema validation antes de settlement

### Veredicto: 🔴 NECESITA CAMBIOS

### Findings

| # | Área | Hallazgo | Severidad |
|---|------|----------|-----------|
| F1 | Dependencias / DB | La tabla `agents` **no tiene columna `output_schema`** — necesita migración. No mencionado en los ACs. Sin esta migración, el issue no puede implementarse. | BLOQUEANTE |
| F2 | Dependencias / DB | La tabla `agent_calls` **no tiene columna `result_type`** — necesita migración. AC-2 la referencia pero no hay tarea ni migración asociada. | BLOQUEANTE |
| F3 | Scope — ¿dónde ocurre? | Los ACs no especifican en qué capa ocurre la validación: `sandbox/invoke/[slug]/route.ts`, `compose/route.ts`, o ambas. Actualmente `validateInput` se llama en ambas. ¿`validateOutput` debe seguir el mismo patrón? | ALTA |
| F4 | Calidad de ACs — "payment reverted" | AC-2 dice "payment SHALL be reverted" sin definir qué significa técnicamente: ¿reverse de crédito en DB? ¿cancelación de transacción Stripe? ¿no-op si pre-auth? Ambiguo e inimplementable tal como está. | ALTA |
| F5 | Cobertura de paths | No hay AC para agentes **sin** `output_schema` (el caso más común en el codebase actual). Debería ser explícito: "IF agent has no output_schema, THEN validation is skipped". | ALTA |
| F6 | Cobertura de paths | No hay AC para output que sea `null` o vacío. ¿Es válido contra cualquier schema? ¿Error si schema existe pero output es null? | MEDIA |
| F7 | Cobertura de paths | En pipelines multi-step (compose), ¿se valida el output de cada step individualmente o solo el output final? No mencionado. | MEDIA |
| F8 | Calidad de ACs — AC-3 (dashboard) | "count of invocations" sin especificar el campo query ni si es por agente, por creador, por periodo. Inimplementable sin más detalle. | MEDIA |
| F9 | Código actual | `schema-validator.ts` exporta `validateInput(schema, input)`. Se necesita `validateOutput(schema, output)` — funcionalmente idéntica, pero nombrarla igual evita ambigüedad. AC-4 dice "usa AJV same as input" pero no menciona si se reutiliza `validateInput` o se crea función nueva. | BAJA |
| F10 | Cobertura de paths | ¿Qué ocurre si `output_schema` guardado en DB es inválido (corrompido)? ¿Falla abierto o cerrado? | BAJA |

### ACs faltantes sugeridos
- **AC-5:** WHEN agent has no `output_schema`, THEN output validation SHALL be skipped (backward compatible)
- **AC-6:** A migration SHALL add `output_schema JSONB` to `agents` table and `result_type TEXT` to `agent_calls` table before this issue can be implemented
- **AC-7:** WHEN output is null/empty AND output_schema exists, THEN validation SHALL fail with schema_violation
- **AC-8:** "Payment reverted" SHALL mean: [crédito revertido en tabla `credits`|transacción marcada como failed] — definir concretamente
- **AC-9:** WHEN pipeline has multiple steps, THEN each step's output SHALL be validated against its respective agent's output_schema independently

---

## WAS-198 — WasiAI Router (Epic)

### Veredicto: 🔴 NECESITA CAMBIOS (Epic sin descomponer)

### Findings

| # | Área | Hallazgo | Severidad |
|---|------|----------|-----------|
| F1 | Calidad de ACs | **Cero ACs formales.** Un Epic sin ACs no puede entrar en sprint. | BLOQUEANTE |
| F2 | Scope | No hay límite claro de qué pertenece a este sprint vs futuras iteraciones. "Hosted by WasiAI" cubre al menos: UI de creación, storage del prompt/tools, provisioning de endpoint, routing de llamadas, billing diferenciado. Sin descomposición, el scope es ilimitado. | BLOQUEANTE |
| F3 | Dependencias | No se menciona qué modelo(s) de LLM provee WasiAI, qué proveedor, ni si hay un contrato de API ya definido. Bloquea la implementación. | ALTA |
| F4 | Cobertura de paths | Sin definir: ¿qué pasa cuando el modelo WasiAI está caído? ¿Hay fallback? ¿SLA? | ALTA |
| F5 | Scope | Sin definir si los agentes "Hosted by WasiAI" comparten el mismo schema de `agents` tabla o necesitan columnas nuevas (`hosted_by_wasiai BOOLEAN`, `wasiai_config JSONB`, etc.) | ALTA |

### Recomendación
Descomponer en al menos 3 stories antes de que entre en sprint:
1. **WAS-198a** — Schema de agente hosted (DB + API contract)
2. **WAS-198b** — Provisioning de endpoint WasiAI (infra/backend)
3. **WAS-198c** — UI de creación "Hosted by WasiAI"

---

## SSRF-002 — Bloquear file:// y ftp:// en $ref

### Veredicto: 🟡 NECESITA CAMBIOS (menores)

### Findings

| # | Área | Hallazgo | Severidad |
|---|------|----------|-----------|
| F1 | Código actual — GAP | `findExternalRefs()` en `schema-validator.ts` solo bloquea `http://` y `https://`. **`file://` y `ftp://` no están bloqueados actualmente**, confirmado en el código. El fix es la razón de este issue — correcto, pero los ACs no describen el mecanismo (función existente vs regex inline). | MEDIA |
| F2 | Cobertura de paths | Los ACs no cubren **otros protocolos peligrosos**: `data:`, `ldap://`, `dict://`, `gopher://`, `jar://`. Si se bloquea file+ftp de forma ad-hoc, quedará una lista incompleta. Sugerido: whitelist de protocolos permitidos (ninguno) en lugar de blacklist. | MEDIA |
| F3 | Cobertura de paths | No hay AC para **case-insensitive** matching: `FILE://`, `FTP://`, `File://`. Las URLs son case-insensitive en el scheme. | MEDIA |
| F4 | Calidad de ACs — AC-3 | "http/https already blocked" — en realidad el código usa `findExternalRefs` que es una función recursiva correcta, no el regex mencionado en la descripción. La descripción confunde el código legacy con el actual. El AC puede generar implementación incorrecta (regex superficial vs recursiva). | MEDIA |
| F5 | Cobertura de paths | No hay AC para `$schema` con `file://` o `ftp://`. El código actual bloquea `$schema` para http/https — la extensión debería ser simétrica. | BAJA |
| F6 | Calidad de ACs | El mensaje de error retornado (`schema_ssrf_blocked`) no incluye qué protocolo fue bloqueado. ¿Debe el error ser informativo? No especificado. | BAJA |

### ACs faltantes sugeridos
- **AC-4:** WHEN schema contains `$ref` or `$schema` with `file://` or `ftp://` (case-insensitive), THEN SHALL return 422 schema_ssrf_blocked
- **AC-5:** Implementation SHALL use the existing `findExternalRefs()` recursive function — NOT a new regex — to maintain recursive coverage
- **AC-6:** WHEN schema contains `$ref` with any non-relative URI scheme other than approved list, THEN SHALL be blocked (considerar whitelist approach)

---

## SCOPE-001 — Explicit scope check en fallback_slug

### Veredicto: 🟢 LISTO — con observación

### Findings

| # | Área | Hallazgo | Severidad |
|---|------|----------|-----------|
| F1 | Código actual — YA IMPLEMENTADO | En `compose/route.ts` línea 298, el scope check **ya existe**: `if (fbAgent && isAgentInScope(fbAgent.slug, fbAgent.category, keyRow.allowed_slugs, keyRow.allowed_categories))`. El código del issue muestra `agent-discovery.ts::discoverAgent()`, que es una ruta diferente (discovery por capability, no por fallback_slug directo). La implementación en compose está correcta. | INFO |
| F2 | Cobertura de paths | AC-2 dice "SHALL return scope_violation error" pero el código actual no retorna `scope_violation` — retorna `{ code: 'no_agent_match' }` (línea ~306). Inconsistencia entre AC y código. | MEDIA |
| F3 | Cobertura de paths | No hay AC para el caso donde `fallback_slug` apunta a un agente **inexistente** (vs existente pero fuera de scope). Actualmente ambos terminan en `no_agent_match` — ¿es intencional? | BAJA |
| F4 | Dependencias | No se menciona si `agent-discovery.ts::discoverAgent()` (el código mostrado en el issue) también necesita el fix. La función `discoverAgent` ya aplica `isAgentInScope` en línea 56, pero `fallback_slug` en ese contexto nunca llama a `discoverAgent`. La confusión de qué código aplicar puede generar un fix duplicado o en el lugar equivocado. | MEDIA |

### ACs faltantes sugeridos
- **AC-4:** WHEN fallback_slug is out of scope, THEN SHALL return `{ error: ..., code: 'scope_violation' }` (actualmente retorna `no_agent_match` — alinear)
- **AC-5:** WHEN fallback_slug agent does not exist in DB, THEN SHALL return `{ code: 'no_agent_match' }` (distinguir de scope violation)

---

## Resumen Ejecutivo

| Issue | Veredicto | Bloqueantes | Cambios Altos | Estado |
|-------|-----------|-------------|---------------|--------|
| WAS-206 | 🔴 NECESITA CAMBIOS | 1 (migración nueva) | 2 | No listo para dev |
| WAS-202 | 🔴 NECESITA CAMBIOS | 2 (migrations faltantes) | 3 | No listo para dev |
| WAS-198 | 🔴 NECESITA CAMBIOS | 2 (sin ACs, sin scope) | 2 | Bloquear sprint hasta descomposición |
| SSRF-002 | 🟡 NECESITA CAMBIOS | 0 | 2 | Puede entrar con ajustes menores |
| SCOPE-001 | 🟢 LISTO | 0 | 0 | Listo — solo alinear código de error |

### Patrones recurrentes detectados

1. **Migrations no mencionadas en ACs** — WAS-206 y WAS-202 dependen de cambios de schema que no están trackeados como dependencia explícita. Riesgo de que dev asuma que ya existen.

2. **Discrepancia AC ↔ código** — SCOPE-001 y WAS-206 tienen conflictos entre lo que el AC promete y lo que el código actual hace/retornará. Sugiere que los ACs fueron escritos sin leer el código.

3. **"Payment reverted" sin definición técnica** — WAS-202 AC-2 es inimplementable sin una definición clara del modelo de pagos afectado.

4. **Epic sin descomposición en sprint** — WAS-198 no debe entrar en el sprint board como implementable. Requiere spike + grooming.

### Recomendación de prioridad para correcciones

1. 🚨 Desbloquear WAS-202: crear las dos migrations (`output_schema`, `result_type`) como pre-task
2. 🚨 Desbloquear WAS-206: crear AC para nueva migración que reemplace la función vulnerable
3. 🟡 Ajustar SSRF-002: agregar AC para case-insensitive + otros protocolos
4. 🟢 Cerrar SCOPE-001: solo alinear el error code en route.ts
5. 🛑 Retirar WAS-198 del sprint activo para grooming
