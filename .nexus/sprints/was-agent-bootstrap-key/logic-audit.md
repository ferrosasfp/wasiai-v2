## Logic Audit — SDD #093 (commit `bcb9e33f4`)

> Auditor: San (subagent logic-auditor)
> Fecha: 2026-03-21
> Archivos auditados:
> - `src/app/api/v1/agents/register/route.ts`
> - `src/lib/agents/health-probe.ts`

---

### AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|-------------|---------------|--------|
| AC1 — Bootstrap orden: slug_check → rate_limit → bootstrap → insert → key → 201 | ✅ Orden correcto | route.ts:~240 (slug), ~252 (rl), ~263 (bootstrap), ~300 (insert), ~352 (key), ~420 (return 201) | ✅ PASS |
| AC2 — creator_email tiene precedencia (corre antes del bootstrap) | ✅ `resolveCreatorFromEmail` se llama cuando `!creatorId && data.creator_email`, y el bloque bootstrap sólo dispara cuando `!creatorId && !data.creator_email` | route.ts:~219 (email resolve), ~263 (bootstrap guard) | ✅ PASS |
| AC3 — Respuesta incluye `management_key_warning` + `next_steps` cuando isBootstrap | ✅ Spread al final del return: `...(isBootstrap && managementKey && {...})` | route.ts:~430–440 | ✅ PASS |
| AC4 — jwt y agent_key: NO aparecen `management_key_warning` bootstrap ni `next_steps` | ⚠️ Parcial — `next_steps` ausente ✅; `management_key_warning` siempre presente como campo (null cuando key existe, mensaje de soporte si falla) | route.ts:~412, ~430 | ⚠️ WARN (ver F1) |
| AC5 — Rollback cadena: creator_profile falla → deleteUser | ✅ En `bootstrapAnonymousCreator`: si el loop falla sin insertar, llama `deleteUser` | route.ts:~141–148 | ✅ PASS |
| AC5 — Rollback cadena: agente falla → deleteUser | ✅ Tanto en el path 409 (slug duplicado) como en otros errores de insert | route.ts:~323–339 | ✅ PASS |
| AC5 — Rollback cadena: key falla → delete agente + deleteUser | ✅ Cuando `isBootstrap && creatorId`: delete agent, luego deleteUser, retorna 503 | route.ts:~365–380 | ✅ PASS |
| AC6 — Username único: `agent_<uuid8>`, colisión → `_2`, `_3`, uuid completo | ✅ Loop `['', '_2', '_3', \`_${uuid}\`]` | route.ts:~131–139 | ✅ PASS |
| AC7 — Probe: 4xx→reviewing, 5xx→draft, timeout/connection_error→draft | ✅ Tres branches correctos en callback + `req.on('error')` | health-probe.ts:~68–100 | ✅ PASS |
| AC7 — ProbeStatus incluye 'draft' | ✅ `type ProbeStatus = 'active' \| 'reviewing' \| 'draft'` | health-probe.ts:~9 | ✅ PASS |
| AC8 — tsc limpio | ✅ Tipado coherente, sin `any` obvios; ProbeStatus correcto | ambos archivos | ✅ PASS (review estático) |

---

### Findings

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| F1 | LOW | Spec-gap / AC4 | `management_key_warning` siempre aparece en el JSON response (como `null` cuando la key se emitió). AC4 dice "no aparecen" — interpretación estricta significa que la clave no debería estar presente (ni como `null`) para jwt/agent_key. `next_steps` sí está ausente correctamente. Tests que usen `hasOwnProperty('management_key_warning')` fallarían. | route.ts:~412 |
| F2 | LOW | AC7 / Edge case | `res.statusCode` undefined/null cae al `else` → `draft`. No está documentado explícitamente pero es comportamiento seguro. Adicionalmente, un 3xx (redirect) cae también en `else` → `draft`, cuando semánticamente sería más correcto `reviewing` (endpoint vivo, configuración incorrecta). Depende de si se quiere manejar redirects explícitamente. | health-probe.ts:~68–80 |
| F3 | INFO | AC5 / Robustez | El rollback de `deleteUser` usa `.catch()` con `console.error` pero no propaga ni alerta si el rollback mismo falla. Si `deleteUser` falla (ej: Supabase timeout), queda un usuario huérfano en `auth.users`. No es un bug del AC pero es deuda técnica de observabilidad. | route.ts:~327, ~337, ~371, ~379 |
| F4 | INFO | AC5 / non-bootstrap path | En el path NO-bootstrap, si el insert de key falla, se logea y se continúa silenciosamente (managementKey queda null). El response incluye `management_key: null` y `management_key_warning: 'Management key could not be issued...'`. Esto es por diseño (no se hace rollback en non-bootstrap), pero la distinción no está explícita en los ACs — confirmar con PO que es intencional. | route.ts:~356–360 |

---

### Respuestas a Preguntas Clave

**P1 — AC1: ¿Bootstrap ocurre DESPUÉS de rate limit y slug check?**
✅ Sí. Orden verificado en el handler:
1. Auth (~línea 166)
2. Zod validation (~línea 200)
3. creator_email resolve (~línea 219)
4. Schema validation (~línea 224)
5. SSRF validation (~línea 235)
6. **slug check** (~línea 240)
7. **rate limit** (~línea 252)
8. **bootstrap** (~línea 263)
9. agent insert (~línea 300)
10. key insert (~línea 352)
11. return 201 (~línea 383)

**P2 — AC5: ¿Rollback del bootstrap cuando agent insert falla con 409 (slug duplicado)?**
✅ Correcto. Dentro del bloque `insertError?.code === '23505'` hay un check `if (isBootstrap && creatorId)` que llama `deleteUser`. Lógica correcta.

**P3 — AC5: ¿Key insert falla → 503 en bootstrap?**
✅ Sí. El bloque `keyInsertError` con `isBootstrap && creatorId`: (1) delete agent, (2) deleteUser, (3) retorna 503 `bootstrap_failed`. El path non-bootstrap falla silenciosamente (por diseño).

**P4 — AC4: ¿El spread `...(isBootstrap && managementKey && {...})` aparece en jwt/agent_key?**
✅ Para jwt: `isBootstrap = false` (bootstrap sólo para open/open_key sin creatorId). Para agent_key: `isBootstrap = false` (agent_key establece creatorId). El spread evalúa a `...(false && ...)` = nada. `next_steps` correctamente ausente. **Ver F1** para `management_key_warning: null`.

**P5 — AC7: ¿statusCode undefined/null cubierto?**
⚠️ Parcialmente. La condición `res.statusCode && res.statusCode >= 200 && ...` es falsy si statusCode es undefined/null/0. Cae al `else` → `draft`. Es un fallback seguro (fail-closed) pero no está documentado. Casos 3xx también caen aquí.

---

### Veredicto

**APROBADO CON OBSERVACIONES**

Los ACs críticos (AC1, AC2, AC3, AC5, AC6, AC7) están implementados correctamente.
F1 es el único finding borderline respecto a los ACs: `management_key_warning: null` aparece en todos los responses (incluidos jwt/agent_key). Si los tests de AC4 verifican ausencia del campo (no sólo ausencia de valor), fallará.

**Acción recomendada antes de merge:**
- Aclarar con PO/QA si AC4 requiere que `management_key_warning` esté **ausente** (no sólo null) para jwt/agent_key. Si sí, mover el campo dentro del spread condicional o usar un helper que omita nulls.
- Documentar comportamiento de 3xx en probe (F2) en el SDD o agregar branch explícito.
