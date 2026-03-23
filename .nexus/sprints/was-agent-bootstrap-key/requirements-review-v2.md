# Requirements Review — WAS-271
**Reviewer:** Requirements Reviewer (NexusAgile v1.3)
**Fecha:** 2026-03-21
**Work Item:** WAS-271 — Anonymous Bootstrap Identity on Open Registration

---

## Estado del código actual

Antes de los findings: el código actual NO implementa bootstrap. Cuando llega `open/open_key` sin `creator_email`, el agente se crea con `creator_id = WASIAI_SYSTEM_CREATOR_ID ?? null` y NO se emite management_key. Los ACs 1, 3, 5, 6 son net-new. AC7 es un fix real (ProbeStatus falta `draft`).

---

## Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| F1 | **Gap** | 🔴 CRÍTICO | AC1 dice "Rate limit por IP ANTES de crear nada" pero en el código actual el rate limit ocurre DESPUÉS del slug check (post-validación, pre-insert). El nuevo bootstrap crea `auth.users` después del rate limit — eso es correcto en papel — pero el AC no especifica el orden exacto en la cadena: ¿rate limit → slug check → auth.users? ¿o slug check → rate limit → auth.users? El orden importa para atomicidad y consumo de tokens de rate limit. | AC1 debe listar el orden explícito: `1. Rate limit IP → 2. Slug check → 3. auth.admin.createUser`. Si slug check falla → no consumir token de rate limit. |
| F2 | **Gap** | 🔴 CRÍTICO | AC5 cubre 3 fallos en la cadena de rollback, pero omite el 4° eslabón: **si management_key insert falla después de crear auth.users + creator_profile + agente**, ¿qué pasa? El código actual hace `logger.error` y continúa (management_key queda null). ¿Es eso aceptable en bootstrap? Un agente sin management_key queda igualmente huérfano. | Agregar AC5.4: `auth.users + creator_profile + agente creados, management_key falla → ¿rollback total o retornar con warning?`. Debe decidirse y documentarse. |
| F3 | **Ambigüedad** | 🟠 ALTA | AC3 dice "next_steps con instrucciones concretas" pero no especifica QUÉ instrucciones. El implementador puede poner cualquier texto. Esto hace el AC no verificable en QA. | AC3 debe incluir los campos exactos del objeto `next_steps`: p.ej. `{ claim_account: string, add_email: string, docs_url: string }` o al mínimo la lista de pasos requeridos como strings literales. |
| F4 | **Ambigüedad** | 🟠 ALTA | AC1 paso 4: "colisión → sufijo _2, _3, luego UUID completo". No especifica: ¿cuántos intentos con sufijo numérico antes de caer a UUID? ¿Es _2, _3, _4... hasta N? ¿O solo _2 y _3 y luego UUID? Sin límite explícito, puede generar loop infinito o comportamiento inconsistente. | AC1.4 debe especificar: "intentar _2, _3; si ambos colisionan → usar UUID completo. Máximo 3 intentos totales." |
| F5 | **Gap** | 🟠 ALTA | AC4 es: "Sin breaking changes en jwt ni agent_key". No tiene trigger, ni verbo verificable, ni aserción concreta. Es inútil como AC — no se puede escribir un test contra esto. | Reescribir: `WHEN POST llega con Authorization: Bearer <jwt válido>, THEN comportamiento SHALL ser idéntico al actual (status 201, sin management_key_warning, sin next_steps). WHEN POST llega con x-agent-key válido, THEN comportamiento SHALL ser idéntico al actual.` |
| F6 | **Conflicto** | 🟠 ALTA | AC7 dice "4xx = reviewing, 5xx/timeout = draft". El código actual mapea **todos** los fallos (4xx, 5xx, timeout, connection_error) → `'reviewing'`. El nuevo AC quiere que 5xx y timeout → `'draft'`. Pero `ProbeStatus` está tipado como `'active' \| 'reviewing'` — agregar `'draft'` rompe el tipo. Además, ¿qué pasa con agentes ya en reviewing que reciben un probe 5xx? ¿Se degradan a draft? El AC no aclara si aplica solo al probe inicial o también a reprobes futuros. | AC7 debe especificar: (a) el scope del cambio (solo probe inicial en registro, o también cualquier probe), (b) la migración del tipo `ProbeStatus`, (c) qué pasa con transición `reviewing → draft` si ya existe un agente en reviewing. |
| F7 | **Gap** | 🟡 MEDIA | AC6 dice "slug existente → 409 SIN crear auth.users ni emitir key". En el código actual, el slug check ocurre ANTES de la rama de bootstrap. Esto es correcto. Pero el AC no menciona explícitamente que el slug check debe ocurrir **antes** de entrar a la lógica bootstrap — es inferible pero no explícito. Si alguien reordena el código, el AC no lo protege. | AC6 agregar: "El slug check SHALL ejecutarse antes de cualquier llamada a `auth.admin.createUser`." |
| F8 | **Gap** | 🟡 MEDIA | No hay AC para **rate limit de bootstrap específico**. El registro con `creator_email` ya tiene `getRegisterEmailLimit()` como segunda barrera. El bootstrap anónimo solo tiene el rate limit por IP. Un atacante desde múltiples IPs (o IPs rotadas) puede crear auth.users ilimitados. ¿Es eso aceptable en scope? Si no, falta un AC de protección adicional (p.ej. rate limit global de bootstrap, o un flag de feature). | Agregar AC9 o nota de scope: "Bootstrap anónimo limitado a X registros por IP por hora (mismo bucket que `getRegisterLimit()`). Documentar explícitamente si se acepta el riesgo de creación masiva de auth.users." |
| F9 | **Ambigüedad** | 🟡 MEDIA | AC1.6: "Emitir management_key con owner_id=userId, budget_usdc=0". No especifica el campo `name` de la key. El código actual usa `${slug}-management`. Para bootstrap, el slug viene del request body. ¿Es correcto usar el slug del agente como nombre de la key antes de confirmar que el agente se creó? Si el agente falla, la key ya tiene ese nombre. Menor, pero puede generar confusion en el dashboard. | AC1.6 especificar el formato del campo `name`: p.ej. `bootstrap-${slug}` o `mgmt-${uuid_8chars}`. |
| F10 | **Gap** | 🟡 MEDIA | AC8 "tsc limpio" no tiene trigger ni scope. ¿Limpio con `strict: true`? ¿Con todos los archivos del proyecto o solo los del scope IN? ¿Antes y después del cambio? | Reescribir: `AFTER implementar WAS-271, `npx tsc --noEmit` SHALL retornar exit code 0 sin errores nuevos en los archivos del Scope IN.` |
| F11 | **Gap** | 🟡 MEDIA | No hay AC para el caso: `authMethod = 'open'` vs `authMethod = 'open_key'`. En el código, `open_key` requiere `OPEN_REGISTRATION_KEY` env var. `open` ocurre cuando NO hay env var configurada. ¿El bootstrap aplica igual a ambos? ¿O solo a uno? El WI dice "open/open_key" pero podrían tener políticas distintas dependiendo de la configuración del entorno. | Confirmar explícitamente que bootstrap aplica idénticamente a ambos `authMethod = 'open'` y `authMethod = 'open_key'`, o documentar la distinción. |
| F12 | **Observación** | ℹ️ INFO | `resolveCreatorFromEmail()` tiene un TODO comentado: "paginar cuando haya >1000 usuarios". Esto es deuda técnica existente, no introducida por WAS-271, pero debería registrarse en backlog. No bloquea este WI. | Crear ticket de seguimiento para paginación de `listUsers`. |

---

## Resumen por AC

| AC | Estado | Issues |
|----|--------|--------|
| AC1 | ⚠️ Incompleto | F1 (orden rate limit), F4 (colisión username), F9 (nombre management_key) |
| AC2 | ✅ Implementado | `resolveCreatorFromEmail()` ya existe y funciona |
| AC3 | ⚠️ Ambiguo | F3 (next_steps sin contenido concreto) |
| AC4 | ❌ No verificable | F5 (sin trigger ni aserción) |
| AC5 | ⚠️ Incompleto | F2 (falta 4° eslabón: management_key falla) |
| AC6 | ⚠️ Implícito | F7 (orden no explícito) |
| AC7 | ⚠️ Conflicto | F6 (tipo ProbeStatus, scope del cambio) |
| AC8 | ⚠️ Ambiguo | F10 (sin trigger ni scope preciso) |

---

## Veredicto

**NECESITA CAMBIOS**

Bloqueantes: F2 (rollback chain incompleto), F3 (next_steps sin especificar), F5 (AC4 no verificable), F6 (AC7 conflicto de tipos y scope).

Recomendado antes de pasar a Spec: resolver F1, F2, F3, F4, F5, F6. Los demás (F7-F11) pueden resolverse en spec o en review posterior.
