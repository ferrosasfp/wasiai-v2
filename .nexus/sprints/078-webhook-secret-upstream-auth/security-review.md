## Security Review — SDD #078 (commits ab4e01a0e + e6c109878)

**Auditor:** Security Reviewer (subagente automatizado)  
**Fecha:** 2026-03-19  
**Stack:** Next.js 14 App Router + Supabase + Avalanche + Viem  
**Alcance:** webhook_secret + upstream auth — 13 archivos  

---

### Superficie de ataque

| Categoría | Endpoint / Función | Auth requerida | Status |
|---|---|---|---|
| A. Auth/Authz | `GET /api/creator/agents/[slug]/webhook-secret` | JWT (Supabase) | ✅ Ownership verificado |
| A. Auth/Authz | `POST /api/creator/agents/[slug]/webhook-secret/rotate` | JWT + CSRF | ✅ Ownership verificado |
| A. Auth/Authz | `POST /api/v1/agents/register` | JWT / agent-key / open-key | ✅ Multi-path correcto |
| A. Auth/Authz | `POST /api/v1/mcp` (tools/call) | wasi_xxx key | ✅ Hash verificado |
| A. Auth/Authz | `POST /api/v1/models/[slug]/invoke` | agent-key / x402 | ✅ Dual-path correcto |
| A. Auth/Authz | `POST /api/v1/compose` | x-api-key | ✅ Verificado + scope check |
| A. Auth/Authz | `POST /api/v1/sandbox/invoke/[slug]` | JWT opcional (anon permitido) | ✅ Rate limit por IP para anon |
| A. Auth/Authz | `GET/POST /api/v1/agents/[slug]/trial` | JWT opcional (anon permitido) | ✅ Rate limit por IP para anon |
| A. Auth/Authz | `POST /api/v1/agents/[slug]/introspect` | agent-key / x402 | ⚠️ Sin rate limiting |
| A. Auth/Authz | `POST /api/v1/jobs/process/[id]` | JOB_PROCESSOR_SECRET | ✅ Bearer secret verificado |
| B. Input | `supabase/migrations/070_webhook_secret.sql` | N/A (DDL) | ⚠️ Sin RLS policy |
| C. Datos Sensibles | `webhook_secret` en upstream calls | N/A | ✅ Solo en header Authorization |
| E. Privilegios | `SELECT *` en agents en múltiples rutas | N/A | ⚠️ Over-fetch de campos sensibles |

---

### Findings

| # | Severidad | Categoría | Detalle | Archivo:línea | Explotabilidad |
|---|---|---|---|---|---|
| 1 | **HIGH** | D. APIs/Red | `POST /api/v1/agents/[slug]/introspect` no tiene **rate limiting** en ninguno de sus dos paths (agent-key y x402). Cualquier cliente puede spamear el endpoint: con agent-key agota el presupuesto del caller a máxima velocidad sin throttle; como servicio público expone DoS al upstream del agente. Los demás endpoints equivalentes (`invoke`, `compose`, `mcp`) sí tienen `checkRateLimit`. | `src/app/api/v1/agents/[slug]/introspect/route.ts:195` (POST handler, no hay llamada a `checkRateLimit` ni `getInvokeLimit`) | Alta — sólo requiere una API key válida o intentar pagar x402. No hay fricción adicional. |
| 2 | **HIGH** | B. Input / SSRF | `POST /api/v1/jobs/process/[id]` llama directamente a `fetch(agent.endpoint_url, ...)` **sin ninguna llamada a `validateEndpointUrl` ni `validateEndpointUrlAsync`**. El endpoint_url se valida en el momento del registro, pero un agente cuyo endpoint_url sea modificado posteriormente (directo en DB, bug en otra ruta, o compromiso de credenciales) permitiría que el job processor realice peticiones a servicios internos (metadata AWS `169.254.169.254`, Supabase internals, Redis). | `src/app/api/v1/jobs/process/[id]/route.ts:78` (bloque `fetch(agent.endpoint_url, ...)`, sin validación previa) | Media — requiere comprometer endpoint_url en la DB o un bug de escritura en otra ruta. El job processor corre con serviceClient (privilegiado). |
| 3 | **MEDIUM** | B. Input / SSRF | `POST /api/v1/agents/[slug]/trial` usa `validateEndpointUrl` **síncrono** (sin DNS probe) en lugar de `validateEndpointUrlAsync`. El validador sync sólo verifica el hostname en lista negra estática; **no detecta DNS rebinding**. Un atacante puede registrar un dominio que resuelve a una IP pública al registrar el agente, y luego hacer reresolución a `127.0.0.1` / `10.x.x.x` cuando se ejecuta el trial. | `src/app/api/v1/agents/[slug]/trial/route.ts:92` (`validateEndpointUrl` — sync) | Media — requiere control DNS del dominio del agente registrado. |
| 4 | **MEDIUM** | B. Input / SSRF | `POST /api/v1/agents/[slug]/introspect` idem: usa `validateEndpointUrl` **síncrono** en `callUpstreamIntrospect`. Mismo vector DNS rebinding que el finding #3. | `src/app/api/v1/agents/[slug]/introspect/route.ts:193` (`validateEndpointUrl` en `callUpstreamIntrospect`) | Media — mismo vector que #3. |
| 5 | **MEDIUM** | E. Menor Privilegio | La migración `070_webhook_secret.sql` **no añade ninguna RLS policy** para proteger la columna `webhook_secret`. La tabla `agents` puede tener políticas existentes, pero al añadir la columna no se restringe explícitamente. Si alguna política RLS existente hace `SELECT *` en `agents` para usuarios no-propietarios (ej. lectura pública del catálogo), el `webhook_secret` quedaría expuesto a cualquier cliente con acceso a la tabla via `createClient()` (sesión de usuario). | `supabase/migrations/070_webhook_secret.sql` (no hay `REVOKE` ni policy de columna) | Media — depende de policies RLS existentes. Sin auditoría de otras migraciones no es confirmable, pero el riesgo es real si hay `SELECT *` en policies públicas. |
| 6 | **MEDIUM** | E. Menor Privilegio | Rutas `invoke`, `mcp`, `introspect` y `compose` ejecutan `select('*')` sobre la tabla `agents`. Esto carga `webhook_secret` y `endpoint_url` completos en el objeto `model` en memoria de la función serverless. Si el logger serializa el objeto `model` en algún path de error o debug (o si hay un bug que incluya `model` en una respuesta de error), el `webhook_secret` se expondría. El logger sí registra `agentId` y `slug` pero en algunos paths registra el objeto `err` completo. | `src/app/api/v1/models/[slug]/invoke/route.ts:153`, `src/app/api/v1/mcp/route.ts:178`, `src/app/api/v1/agents/[slug]/introspect/route.ts:222` | Baja directa, media indirecta — riesgo de exposición via logs si algún path serializa `model`. |
| 7 | **LOW** | A. Auth / CSRF | `GET /api/creator/agents/[slug]/webhook-secret` no valida el header `Origin`. Aunque GET no muta estado, sí devuelve un secreto sensible. Si en el futuro se añade CORS `*` a esta ruta (o se cambia el middleware global), una página maliciosa podría leer el secret via `fetch()` con `credentials: 'include'`. Actualmente sin CORS permisivo no es explotable, pero la defensa-en-profundidad (Origin check) está ausente vs. el endpoint `rotate` que sí la tiene. | `src/app/api/creator/agents/[slug]/webhook-secret/route.ts:14` (no hay `validateCsrf`) | Baja actualmente — no explotable sin un cambio de config de CORS. |
| 8 | **LOW** | C. Datos Sensibles | El backfill en `070_webhook_secret.sql` usa `md5(random()::text \|\| clock_timestamp()::text \|\| id::text) \|\| md5(...)`. `md5` produce 128 bits; dos md5 concatenados suman 256 bits de output pero la entropía efectiva está limitada por `random()` de PostgreSQL (PRNG, no CSPRNG). Para secrets nuevos se usa `randomBytes(32)` (256 bits CSPRNG ✅), pero los agentes existentes son backfilleados con entropía reducida. | `supabase/migrations/070_webhook_secret.sql:10` | Muy baja — requiere capacidad de predict el state del PRNG de PostgreSQL en el momento del backfill. Impacto: un atacante con este conocimiento podría predecir el `webhook_secret` de agentes pre-existentes. Recomendación: forzar rotación post-migración o usar `gen_random_bytes` si pgcrypto disponible. |

---

### Resumen

| Severidad | Cantidad |
|---|---|
| CRITICAL | 0 |
| HIGH | 2 |
| MEDIUM | 4 |
| LOW | 2 |

---

### Veredicto

**REQUIERE CORRECCIÓN**

Los findings HIGH (#1, #2) son explotables y deben corregirse antes de producción:

- **#1** (sin rate limiting en introspect): Añadir `checkRateLimit(getInvokeLimit(), rlId)` al inicio del handler POST, exactamente igual que en `invoke/route.ts`.
- **#2** (SSRF en jobs/process): Añadir `await validateEndpointUrlAsync(agent.endpoint_url)` antes del `fetch()` en el job processor, con manejo de error que marca el job como `failed` si la URL no pasa la validación.

Los MEDIUM (#3, #4) deben corregirse si el sistema procesa agentes de terceros: cambiar `validateEndpointUrl` por `validateEndpointUrlAsync` en `trial` e `introspect`.

El MEDIUM #5 requiere auditoría de las policies RLS existentes en la tabla `agents` para confirmar que `webhook_secret` no es legible por usuarios no-propietarios via cliente normal.

Los MEDIUM #6 y LOW #7, #8 son hardening deseable pero no bloquean producción.

---

*Nota: No se detectaron IDOR, bypass de auth, exposición directa de secrets en respuestas HTTP, ni replay attack vectors en la nueva superficie introducida por SDD #078. La implementación de ownership check (creator_id === user.id) es correcta en ambos endpoints nuevos. La rotación de secret usa `randomBytes(32)` (256-bit CSPRNG). El CSRF en el endpoint rotate está correctamente implementado.*
