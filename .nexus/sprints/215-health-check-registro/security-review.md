## Security Review — SDD #215 (commit 3dff698)

**Revisor:** Security Reviewer — NexusAgil v1.3  
**Fecha:** 2026-03-14  
**Alcance:** `health-probe.ts`, `agents/[slug]/status/route.ts`, cambios en `register/route.ts` y `PATCH creator/[slug]/route.ts`

---

### Superficie de ataque

| Categoría | Endpoint/función | Auth | Status |
|-----------|-----------------|------|--------|
| Health probe | `probeEndpoint(endpointUrl, agentId)` | Ninguna (async interno) | ⚠️ Requiere atención |
| GET status | `GET /api/v1/agents/[slug]/status` | x-agent-key (SHA-256 hash) | ⚠️ Requiere atención |
| Registro fire-and-forget | `register/route.ts` → `probeEndpoint` | JWT-less path | 🔴 Alto riesgo |
| Re-probe en PATCH | `PATCH creator/[slug]/route.ts` | JWT (creator) | ⚠️ Requiere atención |

---

### Findings

| # | Severidad | Categoría | Detalle | Explotabilidad |
|---|-----------|-----------|---------|----------------|
| F-01 | 🔴 CRÍTICO | SSRF / DoS | El probe fire-and-forget en `register/route.ts` para non-JWT permite registrar agentes con `endpoint_url` arbitrario y disparar probes sin autenticación. Un atacante puede usar el sistema como proxy para atacar IPs internas o saturar endpoints de terceros enviando `POST {"ping":true}` repetidamente. | Alta — solo requiere conocer el endpoint de registro |
| F-02 | 🔴 CRÍTICO | SSRF — DNS Rebinding bypass | `validateEndpointUrlAsync` hace DNS probe al momento de validar, pero el fetch real ocurre milisegundos después. Un atacante puede usar DNS TTL=0 para que el nombre resuelva a una IP pública durante la validación y a `169.254.169.254` (metadata de cloud) o `10.x.x.x` durante el fetch. La ventana de rebinding es estrecha pero viable en entornos cloud. | Media-Alta — requiere control de DNS propio |
| F-03 | 🔴 CRÍTICO | Menor Privilegio | `probeEndpoint` usa `createServiceClient()` (SUPABASE_SERVICE_ROLE_KEY) que bypasea RLS para escribir en `health_check`. El probe no necesita acceso completo a la DB; un cliente con permisos solo sobre la columna `health_check` del agente correspondiente sería suficiente. Si `probeEndpoint` es comprometido o hay RCE, el attacker obtiene acceso total a Supabase. | Crítica — superficie innecesariamente grande |
| F-04 | 🟠 ALTO | Info Disclosure — health_check JSONB | `GET /status` retorna `health_check` completo. Si el JSONB contiene campos como `status_code`, `reason: 'http_error'`, o internals del error, se puede usar para fingerprinting de servicios internos. Si un probe alcanza una IP interna (F-02), el `status_code` en el JSONB confirmará que el host existe y respondió. | Alta — amplifica impacto de F-02 |
| F-05 | 🟠 ALTO | Rate Limiting ausente | `GET /status` no tiene rate limiting visible. Un atacante con una `x-agent-key` válida puede hacer scraping masivo de estado, o un atacante puede hacer fuerza bruta de slugs conocidos (el 404 vs 401 revela si el slug existe). | Media — depende de si los slugs son predecibles |
| F-06 | 🟠 ALTO | Re-probe abuse en PATCH | Cada vez que `endpoint_url` cambia se dispara un nuevo probe. Un creador autenticado puede editar el campo repetidamente para lanzar requests POST continuos a cualquier URL que pase `validateEndpointUrlAsync`. Sin throttle, esto es un amplificador de DoS autenticado. | Media — requiere credenciales de creador |
| F-07 | 🟡 MEDIO | IDOR — Timing side-channel | El flujo es: busca slug → verifica ownership. Si el slug no existe → 404; si existe pero no es tuyo → 401. Esto confirma la existencia del slug antes de verificar autorización. Debería devolver 404 en ambos casos cuando el key no es owner. | Baja-Media — información de enumeración |
| F-08 | 🟡 MEDIO | Datos Sensibles — endpoint_url en errores | No está explícito en el diff, pero si `health_check` JSONB almacena el `endpoint_url` del agente (frecuente en sistemas de diagnóstico), `GET /status` lo expone a cualquier holder de `x-agent-key`. Verificar qué campos popula `updateAgentHealth`. | Depende de implementación de updateAgentHealth |
| F-09 | 🟡 MEDIO | Timing attack en key lookup | `createHash('sha256').update(agentKey).digest('hex')` es síncrono y sin salt. Si se filtra la DB, los hashes son atacables offline con diccionario si las keys tienen baja entropía. Considerar HMAC con secret o bcrypt para almacenar keys. | Baja en prod si las keys tienen suficiente entropía |
| F-10 | 🟢 BAJO | Timeout heurístico frágil | `isTimeout = latency_ms >= 4_900` es una aproximación. Si el sistema está bajo carga, un error de red legítimo que tarda >4.9s se clasifica como timeout. No es security issue pero genera falsos negativos en `health_check`. | Informativo |

---

### Remediaciones recomendadas

**F-01 + F-06 (Probe abuse):**
```typescript
// Añadir rate limit por agentId — máximo 1 probe cada 60s
const PROBE_COOLDOWN_MS = 60_000
const lastProbe = await getLastProbeTime(agentId)
if (Date.now() - lastProbe < PROBE_COOLDOWN_MS) return // skip silently
```

**F-02 (DNS Rebinding):**
```typescript
// Resolver la IP una sola vez y usarla directamente en el fetch
const resolvedIp = await resolveAndValidate(endpointUrl) // retorna { url: string, ip: string }
const res = await fetch(resolvedIp.url, {
  headers: { 'Host': new URL(endpointUrl).hostname, ... }
})
```

**F-03 (Menor Privilegio):**
```typescript
// Crear un cliente con permisos solo sobre health_check
// O usar una función RPC de Supabase con SECURITY DEFINER acotada
const probeClient = createRestrictedClient() // solo UPDATE agents SET health_check WHERE id = agentId
```

**F-05 (Rate Limiting GET /status):**
```typescript
// Añadir middleware de rate limit: 60 requests/min por x-agent-key hash
```

**F-07 (IDOR timing):**
```typescript
// Cambiar orden: verificar ownership ANTES de retornar 404 vs 401
// O retornar siempre 404 cuando el key no tiene acceso
if (!agent || keyRecord.owner_id !== agent.creator_id) return 404
```

---

### Resumen

| Severidad | Cantidad |
|-----------|----------|
| 🔴 Crítico | 3 |
| 🟠 Alto | 3 |
| 🟡 Medio | 3 |
| 🟢 Bajo/Info | 1 |
| **Total** | **10** |

---

### Veredicto

> **⛔ REQUIERE CORRECCIÓN**

El commit introduce 3 findings críticos que deben resolverse antes de merge:

1. **F-01** — El path non-JWT en register dispara probes sin autenticación → SSRF/DoS vector real.
2. **F-02** — DNS rebinding puede bypassar `validateEndpointUrlAsync` en entornos cloud → SSRF a metadata endpoints.
3. **F-03** — El uso de `serviceClient` en el probe es innecesario y expone toda la DB si el probe es comprometido.

Los findings F-05 y F-06 son bloqueantes secundarios (rate limiting). F-07, F-08, F-09 pueden resolverse en el mismo PR sin bloquear.

**Acción requerida:** No mergear hasta resolver F-01, F-02, F-03. F-05 y F-06 pueden incluirse en el mismo fix o en PR inmediatamente siguiente.
