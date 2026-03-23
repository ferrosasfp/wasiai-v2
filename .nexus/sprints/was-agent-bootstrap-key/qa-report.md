# QA Report — SDD #093
**Commits:** `bcb9e33f4` + `f96a36cda`
**Fecha:** 2026-03-21
**QA Verifier:** NexusAgile v1.3 subagent

---

## Drift Detection

| Dimensión | Esperado | Real | Status |
|-----------|----------|------|--------|
| Archivo principal | `src/app/api/v1/agents/register/route.ts` | Presente, sin renombrar | ✅ OK |
| Módulo ratelimit | `getBootstrapLimit()` en `src/lib/ratelimit.ts` | Presente, exportado | ✅ OK |
| Módulo health-probe | `ProbeStatus` incluye 'draft' | Presente en tipo union | ✅ OK |
| isBootstrap flag | Declarado y usado en lógica de rollback y respuesta | `let isBootstrap = false` (route.ts:L151) | ✅ OK |

---

## AC Verification

| AC | Status | Evidencia | Notas |
|----|--------|-----------|-------|
| **AC1** — Orden exacto open/open_key sin creator_email | ✅ CUMPLE | `route.ts:259` slug_check → `route.ts:268` `checkRateLimit(getRegisterLimit(),...)` → `route.ts:277` `checkRateLimit(getBootstrapLimit(),...)` → `route.ts:283` `bootstrapAnonymousCreator(...)` → `route.ts:~330` insert agent → `route.ts:~360` `generateApiKey()` → `return NextResponse.json({...}, { status: 201 })` | Orden estrictamente en secuencia |
| **AC2** — open/open_key + creator_email → resolveCreatorFromEmail, NO bootstrap | ✅ CUMPLE | `route.ts:237`: `if (... && data.creator_email) creatorId = await resolveCreatorFromEmail(...)` Bootstrap block: `route.ts:273`: `if (... && !creatorId && !data.creator_email)` — la presencia de creator_email excluye bootstrap | Mutuamente excluyentes por lógica de condición |
| **AC3** — Bootstrap exitoso → management_key_warning (texto real) + next_steps con 3 campos, sin raw key | ✅ CUMPLE | `route.ts:~430`: spread `...(isBootstrap && managementKey && { management_key_warning: 'Store this key securely...', next_steps: { publish_another_agent: '...x-agent-key: <your_management_key>', update_this_agent: '...x-agent-key: <your_management_key>', docs: 'https://wasiai.io/docs/agents/management-key' } })` | Strings contienen placeholder `<your_management_key>`, no la clave raw. Los 3 campos requeridos presentes. |
| **AC4** — jwt/agent_key → next_steps NO aparece, management_key_warning puede ser null | ✅ CUMPLE | `isBootstrap` solo se setea `true` cuando `authMethod === 'open'\|'open_key'` sin creatorId sin creator_email (`route.ts:289`). Para jwt/agent_key: isBootstrap=false → spread no se aplica → next_steps ausente. `management_key_warning` base: `route.ts:~415`: `managementKey ? null : 'Management key could not be issued...'` | Correcto por diseño |
| **AC5** — Rollback en cadena | ✅ CUMPLE | creator_profile falla → `bootstrapAnonymousCreator`: `route.ts:~137` `deleteUser(userId)` → `return null`. Agente insert falla → `route.ts:~350-360`: `if (isBootstrap && creatorId) deleteUser` → return 409/500. Key insert falla → `route.ts:~385-398`: delete agent (`agents.delete().eq('id', agent.id)`) + deleteUser → return 503 | Cadena completa verificada |
| **AC6** — Username `agent_<uuid_8chars>`, colisión → `_2`, `_3`, uuid completo | ✅ CUMPLE | `bootstrapAnonymousCreator route.ts:~122`: `baseUsername = 'agent_${uuid.slice(0, 8)}'`. Loop: `route.ts:~126`: `for (const suffix of ['', '_2', '_3', '_${uuid}'])` | Exactamente 4 intentos: sin sufijo, _2, _3, uuid completo |
| **AC7** — ProbeStatus incluye 'draft'; 4xx→reviewing; 5xx→draft; timeout/connection_error→draft | ✅ CUMPLE | `health-probe.ts:L12`: `type ProbeStatus = 'active' \| 'reviewing' \| 'draft'`. 4xx: `health-probe.ts:~75`: `updateAgentHealth(..., 'reviewing', ...)`. 5xx: `health-probe.ts:~85`: `updateAgentHealth(..., 'draft', ...)`. timeout/connection_error: `health-probe.ts:~96-105`: `updateAgentHealth(..., 'draft', ...)` | Todos los casos mapeados correctamente |
| **AC8** — `npx tsc --noEmit` sin errores | ✅ CUMPLE | Ver sección Build — salida vacía (0 errores) | — |
| **AC-SEC** — `getBootstrapLimit()` existe; namespace `bootstrap:<ip>`; ANTES de bootstrapAnonymousCreator | ✅ CUMPLE | `ratelimit.ts:~131`: `export function getBootstrapLimit()` con `slidingWindow(3, '1 h')`. `route.ts:~277`: `checkRateLimit(getBootstrapLimit(), 'bootstrap:${getIdentifier(request)}')` — precede a la llamada a bootstrapAnonymousCreator en `route.ts:~283` | Namespace exacto: `bootstrap:<ip>` |

---

## Build

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | ✅ PASS — 0 errores, 0 warnings |

---

## Observaciones adicionales

- **management_key_warning base vs bootstrap**: La respuesta base incluye `management_key_warning: null` cuando no hay managementKey, y el spread de bootstrap **sobreescribe** el campo con texto real. El comentario en código `// Bootstrap override — VA AL FINAL, sobreescribe management_key_warning` (route.ts) confirma la intención.
- **Fail-closed en rate limit**: `checkRateLimit` retorna 503 si Upstash no está disponible (ratelimit.ts) — comportamiento correcto.
- **`_2`, `_3` en username**: El bucle detecta colisiones via Postgres unique constraint (`error.code === '23505'`). Errores no-recuperables rompen el loop inmediatamente (`route.ts:~131`).

---

## Veredicto

```
QA PASS ✅
```

Todos los 9 ACs (AC1–AC8 + AC-SEC) verificados con evidencia archivo:línea. Build TypeScript limpio. No se detectaron drifts entre SDD #093 y la implementación.
