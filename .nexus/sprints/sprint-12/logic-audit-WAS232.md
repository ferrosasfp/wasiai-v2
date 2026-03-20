# Logic Audit — WAS-232

**Auditor:** NexusAgile Logic Auditor v1.3  
**Fecha:** 2026-03-17  
**Archivos revisados:**
- `src/app/api/v1/onboard/start/route.ts`
- `src/app/api/v1/onboard/step/route.ts`
- `src/app/api/v1/onboard/[session_id]/route.ts`
- `src/lib/security/validateEndpointUrl.ts`
- `src/lib/ratelimit.ts`

---

## AC Trazabilidad

| AC | Implementado | Status |
|----|-------------|--------|
| POST /start → rate limit 5/hora por IP → 429 | `checkRateLimit(getAgentSignupLimit(), identifier)` | ✅ OK |
| POST /start → crear sesión en onboarding_sessions | `.from('onboarding_sessions').insert({ ip })` | ✅ OK |
| POST /start → `{ session_id, step:1, total_steps:7, question, hint }` HTTP 201 | Respuesta correcta con status 201 | ✅ OK |
| POST /step → 404 si session no existe o expirada | `.gt('expires_at', new Date().toISOString())` + check `sessionError \|\| !session` | ✅ OK |
| POST /step → 409 si status = "completed" | `session.status === 'completed'` check | ✅ OK |
| POST /step → 400 si answer es null/vacío | `answer === null \|\| answer === undefined \|\| answer === ''` | ⚠️ PARCIAL (ver F4) |
| POST /step → validar respuesta por step | Switch por step con validaciones específicas | ✅ OK |
| POST /step → Step 3: ping inline (NO probeEndpoint) | Inline `fetch(answer, ...)` — no usa `probeEndpoint` | ✅ OK |
| POST /step → Step 3: avanzar con warning si ping falla | Actualiza `current_step + 1` y retorna `{ warning, step+1 }` | ✅ OK |
| POST /step → Step 7: email duplicado → 409 | Chequea `createError.message` + `status === 422` | ✅ OK |
| POST /step → Step 7: crear user + key → completar sesión | Creación de user, key, agent, update session | ⚠️ DEFECTO (ver F1, F2, F3) |
| POST /step → Step 7: retornar `{ completed, agent_key, agent_url, slug }` | Retorna todos los campos | ✅ OK (pero ver F2) |
| POST /step → Avanzar → `{ step: N+1, question }` | `nextStep = step + 1`, retorna `QUESTIONS[nextStep]` | ✅ OK |
| GET /:session_id → 404 si no existe | `error \|\| !session` → 404 | ✅ OK |
| GET /:session_id → `{ current_step, status, completed_fields }` | `Object.keys(session.data ?? {})` | ✅ OK |

---

## Findings

| # | Severidad | Detalle | Archivo:línea |
|---|-----------|---------|---------------|
| F1 | 🔴 CRÍTICO | **Agent insert failure completa la sesión igualmente.** Si el insert en `agents` falla (ej. slug collision, constraint violation, red), el código hace `console.error` y continúa: completa la sesión, devuelve `agent_key` y `agent_url`. El usuario recibe una API key activa apuntando a un agente que NO existe en la DB. El `agent_url` retornado (`/en/models/{slug}`) da 404. El `agent_key` en `agent_keys` tiene `owner_id` pero no hay `agent_id` correspondiente — estado incoherente. SDD exige: "crear user + key → completar sesión" como una unidad; si el agente no se crea, la operación no está completa. | `step/route.ts` línea ~189 (`// Still complete session — user was created`) |
| F2 | 🔴 CRÍTICO | **Slug collision silenciosa.** `generateSlug(name)` es determinista: dos agentes con el mismo nombre producen el mismo slug. Si ya existe un agente con ese slug (unique constraint), el insert falla → cae en F1 (session completada, key devuelta, agente no registrado). No hay manejo de colisión (ej. suffix `-2`, `-3`), ni se retorna error al usuario. El slug retornado en la response apunta a un recurso inexistente. | `step/route.ts` línea ~154 (`function generateSlug`) + línea ~189 |
| F3 | 🟠 ALTO | **Sin lock optimista en el update de pasos 1-6.** La lectura de `current_step` y el posterior `update({ current_step: nextStep })` no están coordinados. Dos requests simultáneos con el mismo `session_id` pueden ambos leer `step=N`, ambos validar OK, y ambos escribir `current_step=N+1` con datos diferentes — last writer wins, datos del primero se pierden. No hay `WHERE current_step = N` en la cláusula de update. | `step/route.ts` línea ~217 (`update({ current_step: nextStep, data })`) |
| F4 | 🟡 MEDIO | **`answer === ''` no cubre `answer = 0` para step 5 (precio).** El check global `answer === null \|\| answer === undefined \|\| answer === ''` NO captura el número `0` (JS strict equality). Esto es correcto en sí — `0` no es "vacío" y debe llegar al validador de step 5. Sin embargo, step 5 define rango `[0.001, 100]`, por lo que `0` se rechaza correctamente. El comportamiento final es correcto, pero la intención del AC "400 si answer es null/vacío" es ambigua respecto a valores falsy. **Riesgo real: ninguno** para step 5. Se documenta como observación de robustez. | `step/route.ts` línea ~50 |
| F5 | 🟡 MEDIO | **Concurrencia en step 7: sin lock explícito, mitigado implícitamente.** Dos requests simultáneos con mismo `session_id` pueden pasar el check `status !== 'completed'`. En step 7, ambos intentan `createUser(email)` con el mismo email → el segundo recibe 422 (duplicate) → retorna 409 al cliente. No se crean dos users ni dos keys. **Sin embargo**, esto es una dependencia implícita en el constraint de email del Auth provider — no es un lock deliberado en el código. Si `createUser` no tiene unique constraint (o se usa un proveedor diferente), la doble creación sería posible. No hay idempotency key ni `SELECT FOR UPDATE` en la lógica del wizard. | `step/route.ts` línea ~138 (`createUser`) |
| F6 | 🟢 INFO | **SSRF en step 3: correctamente prevenido.** `validateEndpointUrlAsync(answer)` se llama ANTES del ping inline (línea ~86 del switch case 3). Incluye: validación de protocolo HTTPS, blocklist de IPs privadas IPv4/IPv6, DNS probe para prevenir DNS rebinding (NG-005). No hay bypass SSRF posible con la implementación actual. | `step/route.ts` case 3 + `validateEndpointUrl.ts` |
| F7 | 🟢 INFO | **GET /:session_id no verifica expiración.** El endpoint GET no filtra por `expires_at`. Una sesión expirada sigue siendo accesible vía GET. SDD solo especifica "404 si no existe" para GET (no menciona expiración), por lo que no es un defecto de spec, pero puede exponer datos de sesiones caducadas. | `[session_id]/route.ts` línea ~12 |

---

## Análisis del Checklist Específico

### 1. Step 3: ¿`validateEndpointUrlAsync` se llama antes del ping? ¿SSRF posible?
**✅ Cubierto.** El código en `case 3:` llama `await validateEndpointUrlAsync(answer)` primero (con `try/catch → return 400`). Solo si pasa la validación se ejecuta el `fetch`. La función realiza: parse URL, whitelist HTTPS-only, blocklist IPv4/IPv6, y DNS probe con resolución de hostname. **No hay bypass SSRF.**

### 2. Step 7: Si `agent insert` falla, ¿session se completa? ¿Se devuelve agent_key?
**🔴 SÍ — bug confirmado (F1).** El código tiene comentario explícito: `// Still complete session — user was created`. En caso de error en el insert de `agents`, la sesión se marca `completed` y se devuelve el `agent_key` al cliente. El usuario queda con una key válida pero sin agente registrado.

### 3. Concurrencia: ¿doble step 7 posible (zombie user + doble key)?
**🟡 Mitigado implícitamente, no explícitamente (F5).** Dos requests simultáneos que pasen el check `status !== 'completed'` terminarían con el segundo fallando en `createUser` (email duplicate → 422). No se generan dos users ni dos keys. Pero no existe un lock formal (row lock, mutex, idempotency key). Si el email-as-lock no existe (proveedor diferente, tabla `auth.users` sin unique), el doble registro sería posible.

### 4. `answer === ''` vs `answer === 0`:
**✅ No es un bug (F4 — observación).** `0 === ''` es `false` en JS. El número `0` pasa el check global y llega al validator de step 5, donde `num < 0.001` lo rechaza correctamente con 400. El comportamiento final cumple el SDD.

### 5. Slug collision en step 7:
**🔴 Bug confirmado (F2).** No hay manejo de colisión. Un slug duplicado produce `agentError`, que se ignora (F1). No se intenta generar un slug alternativo.

---

## Veredicto: 🔴 REQUIERE CORRECCIÓN

**Bloqueantes para release:**
- **F1** (CRÍTICO): Agent insert failure debe rollback completo o al menos bloquear la completion. No devolver `agent_key` si el agente no existe.
- **F2** (CRÍTICO): Implementar slug con suffix incremental (`slug-2`, `slug-3`) o UUID suffix para evitar colisiones silenciosas.

**Recomendados antes de merge:**
- **F3** (ALTO): Agregar `eq('current_step', step)` al WHERE del update, o usar transacción con lock para garantizar atomicidad en la transición de pasos.
- **F5** (MEDIO): Considerar idempotency key o `UPDATE ... WHERE status != 'completed'` con row-level lock para step 7.

**Post-release:**
- **F7** (INFO): Decidir si GET debe respetar expiración por consistencia de UX.
