## Security Review — SDD #093 (commit `bcb9e33f4`)

**Archivos revisados:** `src/app/api/v1/agents/register/route.ts`, `src/lib/agents/health-probe.ts`
**Reviewer:** Security Reviewer subagent (NexusAgile v1.3)
**Fecha:** 2026-03-21

---

### Superficie de ataque

| Categoría | Función/Endpoint | Auth | Status |
|---|---|---|---|
| Anonymous bootstrap | `POST /api/v1/agents/register` → `bootstrapAnonymousCreator()` | open / open_key | ⚠️ Riesgo: flood |
| Creator por email | `resolveCreatorFromEmail()` | open / open_key | ⚠️ Bug latente |
| Gestión de usuarios | `serviceClient.auth.admin.createUser/deleteUser` | service_role | ✅ Correcto en contexto |
| Rollback auth.users | `auth.admin.deleteUser(creatorId)` en error paths | service_role | ✅ Scope correcto |
| Health probe SSRF | `probeEndpoint()` en `health-probe.ts` | fire-and-forget | ✅ Doble validación activa |
| Probe status 4xx | `updateAgentHealth(..., 'reviewing', ...)` | N/A | ℹ️ Cambio semántico menor |

---

### Findings

| # | Severidad | Categoría | Detalle | Archivo:línea | Explotabilidad |
|---|---|---|---|---|---|
| F1 | **HIGH** | Resource Exhaustion / Bootstrap Flood | El rate limit es **por IP** (`getIdentifier(request)`). En modo `open` (sin `OPEN_REGISTRATION_KEY` configurado) o en `open_key` con la key conocida, un atacante distribuyendo requests desde múltiples IPs puede bypassear el rate limit y disparar `bootstrapAnonymousCreator()` masivamente. Cada request exitoso crea: 1 `auth.users`, 1 `creator_profile`, 1 `agent`, 1 `agent_key`. No existe un cap global de bootstraps totales ni throttle en Supabase `auth.admin.createUser`. | `route.ts:~265–280` (bootstrap block), `route.ts:~251` (rate limit check) | **Alta** en `open` mode; **Media** en `open_key` (key puede revocarse). Impacto: polución de BD, agotamiento de cuota Supabase auth, costos de almacenamiento. |
| F2 | **MEDIUM** | Data Integrity / Pagination Gap | `resolveCreatorFromEmail()` llama `listUsers({ perPage: 1000 })` con un `TODO` explícito: si hay >1000 usuarios, no pagina y puede no encontrar el email existente. Resultado: intenta `createUser` con un email ya registrado, falla silenciosamente y devuelve `null`. Esto bloquea la registración de un creator real con email conocido cuando la BD tenga >1000 usuarios. | `route.ts:~101-107` | **Baja** para exploit activo (requiere BD grande); **Media** para disponibilidad del servicio cuando escale. |
| F3 | **LOW** | Information Disclosure | En la respuesta de bootstrap, el campo `next_steps.publish_another_agent` embebe el `managementKey` en texto plano dentro del string: `` `POST /api/v1/agents/register with header x-agent-key: ${managementKey}` ``. Si el response body es loggeado en infraestructura (APM, proxy, access logs), la key queda expuesta. | `route.ts:~382-385` (sección `isBootstrap` del return) | **Baja** (requiere acceso a logs del sistema). |
| F4 | **LOW** | Behavior Change — 4xx → reviewing | Anteriormente un endpoint con 4xx podría haber caído en `draft`; ahora se clasifica como `reviewing` ("endpoint vivo pero rechaza input"). Un agente con endpoint que devuelve 403/404 en todo momento queda en `reviewing` indefinidamente en lugar de `draft`, retrasando la limpieza de registros inválidos. No es una vulnerabilidad de seguridad directa, pero suaviza el ciclo de vida. | `health-probe.ts:~68-76` | **Informativa** desde perspectiva de seguridad. |
| F5 | INFO | ✅ UUID no influenciable | `randomUUID()` usa `crypto` de Node.js (CSPRNG). El atacante no puede influir en el valor del UUID ni inducir colisiones. El email sintético `agent_<uuid>@bootstrap.wasiai.internal` es determinístico sobre el UUID, imposible de predecir o colisionar intencionalmente. | `route.ts:~121-122` | **Sin riesgo.** |
| F6 | INFO | ✅ Rollback scope correcto | `auth.admin.deleteUser(creatorId)` en los paths de rollback usa el `creatorId` asignado en el mismo scope del handler (variable local `= bootstrapResult.userId`). El flag `isBootstrap` guarda el bloque. No existe riesgo de borrar usuarios legítimos porque: (a) bootstrap solo corre si `!creatorId` al inicio, (b) `isBootstrap` nunca es `true` para flujos `jwt`/`agent_key`. | `route.ts:~298-316, ~332-348` | **Sin riesgo.** |
| F7 | INFO | ✅ SSRF en probe intacto | `probeEndpoint()` mantiene doble validación: (1) `validateEndpointUrlAsync()` resuelve y valida la IP antes de conectar, (2) la conexión va directamente a `resolvedIp` con SNI explícito (anti DNS-rebinding). El cambio de `ProbeStatus` (añadir `'draft'`) es puramente semántico y no toca la lógica anti-SSRF. Guard adicional: si `resolvedIp` es vacío (Edge runtime), falla-cerrado con `dns_rebinding_blocked`. | `health-probe.ts:~28-50` | **Sin riesgo.** |
| F8 | INFO | ✅ serviceClient en bootstrap | Usar `serviceClient` (service_role) para `auth.admin.createUser` es la única opción disponible en Supabase: no existe una API de menor privilegio para crear usuarios programáticamente sin sesión activa. El uso está justificado y acotado. | `route.ts:~119-138` | **Sin riesgo dado el contexto.** |

---

### Resumen

| Severidad | Cantidad |
|---|---|
| 🔴 HIGH | 1 |
| 🟠 MEDIUM | 1 |
| 🟡 LOW | 2 |
| ℹ️ INFO | 4 |

---

### Veredicto

## ⚠️ REQUIERE CORRECCIÓN

El flujo de bootstrap anónimo introduce un vector de **resource exhaustion** real (F1). El rate limit existente (por IP) es insuficiente para el modo `open` sin identidad: un atacante distribuido puede crear miles de `auth.users` sintéticos. Antes de merging a producción se recomienda:

1. **F1 — Mitigación obligatoria:** Añadir un **cap global de bootstraps** (e.g., contador en Redis/KV con ventana temporal, o límite absoluto de usuarios `@bootstrap.wasiai.internal` en la BD). Alternativamente, requerir un token de bootstrap único por registro (similar a `OPEN_REGISTRATION_KEY` pero de un solo uso).

2. **F2 — Fix antes de escalar:** Paginar `listUsers` en `resolveCreatorFromEmail()` para soportar >1000 usuarios. El TODO ya está marcado; debe priorizarse antes de que la BD supere ese umbral.

3. **F3 — Cosmético:** Considerar no embeber la management key dentro de strings descriptivos de `next_steps`; o al menos asegurarse de que esos campos no se loggean en APM/proxy.

4. **F4 — Producto:** Revisar si 4xx → `reviewing` (en lugar de `draft`) es el comportamiento deseado del ciclo de vida. Sin implicación de seguridad directa.

Los controles SSRF (F7), el rollback (F6), y el uso de `serviceClient` (F8) están **correctamente implementados**.
