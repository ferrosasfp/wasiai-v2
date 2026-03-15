# Security Review — Sprint 5
**Reviewer:** Security Subagent (NexusAgil v1.3)  
**Fecha:** 2026-03-14  
**Issues:** F-02 · WAS-187 · WAS-199  
**Archivos revisados:**
- `src/lib/agents/health-probe.ts`
- `src/lib/security/validateEndpointUrl.ts`
- `src/lib/agent-discovery.ts`
- `src/app/api/v1/agents/[slug]/reputation/route.ts`
- `src/app/api/v1/agents/discover/route.ts` (contexto adicional)

---

## F-02 — DNS Rebinding Fix

### Superficie de ataque

El flujo es: `registerAgent → validateEndpointUrlAsync → probeEndpoint`.  
El DNS rebinding clásico consiste en: registrar un dominio cuyo TTL=0 que inicialmente resuelve a una IP pública, pero en una segunda resolución (al conectar) devuelve `127.0.0.1`. El fix en F-02 resuelve el hostname **una sola vez**, guarda la IP, y luego conecta directamente a esa IP con `https.request({host: resolvedIp})`.

---

### Findings

#### [HIGH] F-02-01 — SSRF silencioso por `resolvedIp = ''`

**Archivo:** `validateEndpointUrl.ts`, líneas finales del bloque `catch` en `validateResolvedIPs`  
**Descripción:**

```typescript
// Module not available (Edge runtime) — skip probe silently, return empty string
return ''
```

Este path de fallback retorna `''` cuando ocurre cualquier error que **no** sea:
- `err.message.includes('private or internal')`
- ENOTFOUND / ETIMEOUT / EAI_AGAIN / "No addresses resolved"

En `health-probe.ts`, si `resolvedIp = ''` (vacío), se ejecuta:

```typescript
const options = {
  host: resolvedIp,  // host: ''
  ...
}
const req = https.request(options, ...)
```

En Node.js, `https.request({host: ''})` conecta a **`localhost` (127.0.0.1)** por defecto. Esto es un bypass de SSRF:

1. El atacante registra `https://attacker.com/health`
2. `validateEndpointUrl` pasa el check estático (hostname no está en blocklist)
3. `dns.lookup` falla con un error no contemplado (e.g., error de red transitorio, formato de error custom del DNS resolver del sistema, excepción inesperada del módulo)
4. El catch retorna `''`
5. `health-probe.ts` conecta a `127.0.0.1:443` con `Host: attacker.com`
6. Si hay algún servicio HTTPS en localhost (Next.js dev server, otro servicio), recibe el request

**Vectores de error que caen al fallback silencioso:**
- Errores del OS resolver no contemplados en la lista (e.g., `ESERVFAIL`, `ENODATA`)
- Excepciones de formato inesperado del módulo `node:dns/promises`
- Qualquier error cuyo `.message` no matchea exactamente las strings hardcodeadas

**Impacto:** SSRF hacia localhost/red interna si se puede triggear el fallback.

**Fix:**
```typescript
// En validateResolvedIPs: eliminar el fallback silencioso
// Si dns.lookup falla por cualquier razón → bloquear, no continuar

// Opción A: relanzar cualquier error desconocido
throw new Error(`DNS probe failed: ${(err as Error).message}`)

// Opción B: en health-probe.ts, verificar antes de usar
if (!resolvedIp) {
  await updateAgentHealth(serviceClient, agentId, 'reviewing', {
    passed: false,
    reason: 'ssrf_blocked',
    message: 'DNS probe returned empty result.',
    fix: 'Ensure your endpoint has a valid public DNS record.',
  })
  return
}
```

**Recomendación:** Ambas correcciones. Fail-closed en `validateResolvedIPs` + guard en `health-probe.ts`.

---

#### [MEDIUM] F-02-02 — IPv6 como `host` en `https.request` puede fallar silenciosamente

**Archivo:** `health-probe.ts` + `validateEndpointUrl.ts`  
**Descripción:**

`dns.lookup` con `{ all: true }` puede retornar una dirección IPv6 como primera entrada (e.g., `2001:db8::1`). En `health-probe.ts` se usa:

```typescript
host: resolvedIp,  // e.g., '2001:db8::1'
```

En Node.js `http/https`, el campo `host` se usa para el header HTTP (incluye puerto), mientras que `hostname` es el correcto para la IP de conexión TCP. Para IPv6, **`hostname` requiere brackets** (`[2001:db8::1]`), pero `host` sin brackets puede provocar un parsing incorrecto.

Resultado: la conexión hacia un agente con IPv6-only falla con `connection_error`, marcando el agente como 'reviewing' injustamente. No es un vector de ataque directo, pero sí un bug funcional que podría usarse para denegar el health check a agentes IPv6.

**Fix:**
```typescript
// Formatear IPv6 correctamente para Node.js net/https
const isIPv6 = resolvedIp.includes(':')
const hostForConnection = isIPv6 ? `[${resolvedIp}]` : resolvedIp

const options = {
  hostname: hostForConnection,  // usar hostname, no host
  port: ...,
  headers: { 'Host': urlObj.hostname },
  servername: urlObj.hostname,
  ...
}
```

---

#### [LOW] F-02-03 — Prefijo `0.0.0.0` no bloquea rango `0.x.x.x`

**Archivo:** `validateEndpointUrl.ts`

```typescript
'0.0.0.0',  // solo bloquea exactamente 0.0.0.0
```

Las IPs `0.1.2.3`, `0.0.1.0`, etc. (rango `0.0.0.0/8`) en algunos sistemas Unix rutean a loopback. El fix es cambiar a `'0.'` como prefijo.

**Impacto:** Muy bajo (requiere que el sistema objetivo tenga rutas al rango 0/8).

---

#### [INFO] F-02-04 — Redirect no seguido (comportamiento correcto, documentar)

`https.request` de Node.js **NO sigue redirects** automáticamente. Si el endpoint responde 301/302, el status check `>= 200 && < 300` falla y el agente queda en 'reviewing'. Esto es el comportamiento correcto y seguro. **No es una vulnerabilidad.**

Sin embargo, merece documentación explícita: si en el futuro se agrega seguimiento de redirects, debe validarse la IP destino del redirect.

---

#### [INFO] F-02-05 — TLS: `servername` explícito es correcto

El uso de `servername: urlObj.hostname` es la implementación correcta para conexión directa a IP con TLS. El certificado se valida contra el hostname original, previniendo ataques de SNI. **SEGURO.**

---

### Veredicto: **REQUIERE CORRECCIÓN**

F-02-01 (HIGH) debe corregirse antes del deploy. F-02-02 (MEDIUM) en este sprint.

---

## WAS-187 — discoverAgent (ranking con performance_score)

### Superficie de ataque

La función `discoverAgent()` en `agent-discovery.ts` es una librería interna. El endpoint público `GET /api/v1/agents/discover` en `discover/route.ts` NO usa esta función — utiliza directamente el RPC `discover_agents_v2`. El campo `min_performance` no está expuesto en el schema Zod público:

```typescript
// discover/route.ts — schema actual
const discoverSchema = z.object({
  category:   z.string().optional(),
  max_price:  z.coerce.number().positive().optional(),
  capability: z.string().optional(),
  limit:      z.coerce.number().int().min(1).max(50).default(20),
})
// ↑ min_performance NO está aquí → el endpoint público no lo acepta
```

---

### Findings

#### [MEDIUM] WAS-187-01 — `NaN` en `min_performance` causa query silenciosamente incorrecta

**Archivo:** `agent-discovery.ts`  
**Descripción:**

```typescript
if (constraints.min_performance !== undefined) {
  query = query.gte('performance_score', constraints.min_performance)
}
```

Si un caller interno pasa `min_performance: NaN`:
- `NaN !== undefined` → **la condición pasa**
- `JSON.stringify(NaN)` → `"null"` (estándar JSON)
- PostgREST recibe `.gte('performance_score', null)` → comportamiento indefinido (puede retornar todos los registros o fallar silenciosamente)

Esto no es explotable desde el endpoint público actual, pero es un bug latente para callers internos (e.g., si `invoke-agent` parsea query params y pasa `min_performance` sin validación de tipo).

**Fix:**
```typescript
if (constraints.min_performance !== undefined && 
    typeof constraints.min_performance === 'number' &&
    !isNaN(constraints.min_performance)) {
  query = query.gte('performance_score', constraints.min_performance)
}
```

---

#### [INFO] WAS-187-02 — `min_performance` no expuesto en API pública

**Confirmado:** El schema Zod del endpoint público no incluye `min_performance`. El param es ignorado si se envía. No hay scope creep en la API pública actualmente. Sin embargo, cuando se agregue al schema (presumiblemente en este sprint), debe incluir validación de rango:

```typescript
min_performance: z.coerce.number().min(0).max(100).optional(),
```

---

#### [INFO] WAS-187-03 — SQL injection no es un vector

Supabase client usa PostgREST con queries parametrizadas. Pasar un string como `"0; DROP TABLE agents"` sería coercionado por Zod a `NaN` y rechazado, o fallaría en la serialización PostgREST. **No explotable.**

---

### Veredicto: **SEGURO** (para deploy actual)

El endpoint público no expone `min_performance`. El fix de NaN (WAS-187-01) es MEDIUM y debe corregirse antes de exponer el param en la API pública.

---

## WAS-199 — /reputation endpoint

### Superficie de ataque

`GET /api/v1/agents/[slug]/reputation` — endpoint público sin auth, devuelve métricas operacionales de un agente. WAS-199 agrega campos: `performance_score`, `reputation_score`, `reputation_count`, `erc8004_score`.

---

### Findings

#### [MEDIUM] WAS-199-01 — 3 queries DB + 1 RPC por request sin cache compartida

**Descripción:**

Cada request al endpoint realiza:
1. `supabase.from('agents').select(...)` — query principal
2. `supabase.rpc('get_agent_percentile_metrics', ...)` — RPC de percentiles
3. `supabase.from('agent_calls').select(...)` — para `calcTrend()` (últimos 14 días de calls)
4. `supabase.from('agent_calls').select(created_at).limit(1)` — last invocation

El rate limiter es 60 req/min **por IP**, pero múltiples IPs pueden hacer 60 req/min cada una. Con 100 IPs atacantes:
- 6,000 req/min → 24,000 queries DB/min → potencial DB load amplification

El header `Cache-Control: public, max-age=60` ayuda a nivel CDN/proxy, pero los requests directos a la API (e.g., agentes autónomos) no pasan por CDN.

**Impacto:** DoS a nivel DB con múltiples IPs coordinadas. Especialmente costosa la query de `calcTrend` (scan de 14 días de `agent_calls` sin índice visible).

**Fix recomendado:**
- Agregar un índice en `agent_calls(agent_id, created_at)` si no existe
- Considerar rate limit global por slug (no solo por IP)
- Cachear el resultado completo en Redis/Upstash por `slug` con TTL 60s

---

#### [LOW] WAS-199-02 — Exposición de `invocation_count` (total_calls)

**Descripción:**

```typescript
invocation_count: agent.total_calls ?? 0,
```

El campo `total_calls` expone el volumen de uso total de cada agente. Esto permite a competidores o actores maliciosos identificar los agentes más utilizados (y potencialmente más valiosos como targets de ataque o competencia comercial).

**Impacto:** Información de negocio sensitiva expuesta públicamente. Sin embargo, dado que el endpoint es intencionalmente público para pre-invocation trust signals, es una decisión de producto más que una vulnerabilidad.

**Recomendación:** Documentar explícitamente la decisión de exponer este campo. Considerar bucketing (e.g., `"1k-10k calls"`) en lugar del número exacto.

---

#### [LOW] WAS-199-03 — `erc8004_score` duplica `reputation_score`

```typescript
erc8004_score: agent.reputation_score ?? null,  // = reputation_score
reputation_score: agent.reputation_score ?? null,
```

Ambos campos tienen el mismo valor. No es un problema de seguridad, pero expone la misma información dos veces con nombres diferentes, lo que puede confundir a clientes sobre cuál usar.

---

#### [INFO] WAS-199-04 — Rate limit existente es adecuado para uso normal

60 req/min por IP con sliding window es razonable para pre-invocation lookups. Los campos nuevos no cambian el rate limit configurado. El costo adicional es en queries DB (ver WAS-199-01), no en el rate limiter mismo.

---

### Veredicto: **REQUIERE CORRECCIÓN** (MEDIUM antes de escalar a producción)

Sin blocker para deploy, pero WAS-199-01 debe resolverse antes de tráfico significativo.

---

## Resumen Ejecutivo

### Por severidad

| Severidad | Cantidad |
|-----------|----------|
| CRITICAL  | 0        |
| HIGH      | 1        |
| MEDIUM    | 3        |
| LOW       | 3        |
| INFO      | 4        |

### Por issue

| Issue   | Veredicto              | Finding crítico                                      |
|---------|------------------------|------------------------------------------------------|
| F-02    | ⚠️ REQUIERE CORRECCIÓN | F-02-01 (HIGH): SSRF silencioso por `resolvedIp = ''` |
| WAS-187 | ✅ SEGURO (deploy actual) | WAS-187-01 (MEDIUM): NaN bypass antes de exponer en API pública |
| WAS-199 | ⚠️ REQUIERE CORRECCIÓN | WAS-199-01 (MEDIUM): DB load amplification (3 queries + RPC por request) |

### Acción inmediata

1. **[HIGH] F-02-01** — Fail-closed en `validateResolvedIPs` + guard en `health-probe.ts` antes del deploy.
2. **[MEDIUM] F-02-02** — Fix IPv6 formatting para `https.request` en este sprint.
3. **[MEDIUM] WAS-187-01** — Validación de `NaN` en `discoverAgent` antes de exponer `min_performance` en API pública.
4. **[MEDIUM] WAS-199-01** — Índice en `agent_calls(agent_id, created_at)` + cache Redis por slug.
