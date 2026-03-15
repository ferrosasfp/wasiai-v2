# QA Report — Sprint 5

> Generado: 2026-03-14 | Verificador: NexusAgil QA v1.3
> Repo: `/home/ferdev/.openclaw/workspace/wasiai-v2`

---

## F-03

### AC Verification

| AC | Status | Evidencia |
|----|--------|-----------|
| AC1: `// SECURITY_NOTE` dentro de `probeEndpoint` con (a) sin sesión, (b) escribe en `agents`, (c) `.eq('id', agentId)` | ✅ CUMPLE | `health-probe.ts:21-25` — comentario presente, menciona "probe corre sin sesión de usuario", "Necesita escribir en la tabla `agents`", y "via `.eq('id', agentId)`" |
| AC2: Comentario indica scope limitado a `agents` table únicamente | ✅ CUMPLE | `health-probe.ts:24` — "El scope está limitado únicamente a updates en `agents`" |

### Build: PASS
### Veredicto: ✅ QA PASS

---

## WAS-199

### AC Verification

| AC | Status | Evidencia |
|----|--------|-----------|
| AC1: Response incluye `performance_score` (0-100, null si <5 calls) | ✅ CUMPLE | `route.ts:158` — `performance_score: agent.performance_score ?? null, // WAS-213: 0-100, null si <5 calls` |
| AC2: Response incluye `reputation_score` (0-1) | ✅ CUMPLE | `route.ts:159` — `reputation_score: agent.reputation_score ?? null,  // votos: 0.0-1.0` |
| AC3: `erc8004_score` === `reputation_score` (no null hardcodeado) | ✅ CUMPLE | `route.ts:161` — `erc8004_score: agent.reputation_score ?? null,  // WAS-199: normalizado 0-1 (= reputation_score)` |
| AC4: `format_compliance_pct` SHALL ser null (placeholder) | ❌ NO CUMPLE | Campo `format_compliance_pct` **ausente** del response en `route.ts` — no existe en el JSON retornado |
| AC5: `reputation_count` en el response | ✅ CUMPLE | `route.ts:160` — `reputation_count: agent.reputation_count ?? 0,` |

### Build: PASS
### Veredicto: ❌ QA FAIL (AC4 ausente)

---

## WAS-191

### AC Verification

| AC | Status | Evidencia |
|----|--------|-----------|
| AC1: Badge se muestra cuando `performance_score` no null | ✅ CUMPLE | `PerformanceBadge.tsx:10` — guard `if (score === null \|\| score === undefined) return null` → else renderiza; `page.tsx:316` lo usa |
| AC2: Badge no renderiza cuando `performance_score` es null | ✅ CUMPLE | `PerformanceBadge.tsx:10` — `if (score === null \|\| score === undefined) return null` |
| AC3: `score >= 90` → color verde | ✅ CUMPLE | `PerformanceBadge.tsx:14` — `colorClasses = 'text-green-500 bg-green-500/10'` |
| AC4: `score >= 70 AND < 90` → color amarillo | ✅ CUMPLE | `PerformanceBadge.tsx:16` — `else if (score >= 70) { colorClasses = 'text-yellow-500 bg-yellow-500/10' }` |
| AC5: `score < 70` → color rojo | ✅ CUMPLE | `PerformanceBadge.tsx:18` — `else { colorClasses = 'text-red-500 bg-red-500/10' }` |
| AC6: `Model` type tiene campo `performance_score?: number \| null` | ✅ CUMPLE | `models.types.ts:55` — `// WAS-191: Operational performance score (0-100)` / `performance_score?: number \| null` |
| AC7: i18n namespace es `modelDetail` (no 'models') | ✅ CUMPLE | `PerformanceBadge.tsx:7` — `useTranslations('modelDetail')`; key en `messages/en.json:738` bajo `"modelDetail"` > `"performanceBadge"` |

### Build: PASS
### Veredicto: ✅ QA PASS

---

## WAS-187

### AC Verification

| AC | Status | Evidencia |
|----|--------|-----------|
| AC1: Orden `performance_score DESC NULLS LAST`, luego `reputation_score DESC NULLS LAST`, luego `price_per_call ASC` | ✅ CUMPLE | `agent-discovery.ts:48-50` — `.order('performance_score', { ascending: false, nullsFirst: false })` → `.order('reputation_score', { ascending: false, nullsFirst: false })` → `.order('price_per_call', { ascending: true })` |
| AC2: `constraints.min_reputation` filtra `reputation_score` | ✅ CUMPLE | `agent-discovery.ts:40` — `query = query.gte('reputation_score', constraints.min_reputation)` |
| AC3: `constraints.min_performance` filtra `performance_score` (nuevo) | ✅ CUMPLE | `agent-discovery.ts:43` — `query = query.gte('performance_score', constraints.min_performance)` |
| AC4: `performance_score` en el SELECT | ✅ CUMPLE | `agent-discovery.ts:33` — `.select('id, slug, name, category, price_per_call, endpoint_url, status, max_rpm, max_rpd, capabilities, reputation_score, performance_score')` |
| AC5: `DiscoveredAgent` interface tiene `performance_score` | ✅ CUMPLE | `agent-discovery.ts:18` — `performance_score?: number \| null  // NUEVO (WAS-187)` |

### Build: PASS
### Veredicto: ✅ QA PASS

---

## F-02

### AC Verification

| AC | Status | Evidencia |
|----|--------|-----------|
| AC1: `validateEndpointUrlAsync` retorna `Promise<string>` (IP) | ✅ CUMPLE | `validateEndpointUrl.ts:121` — `export async function validateEndpointUrlAsync(rawUrl: string): Promise<string>` retorna el resultado de `validateResolvedIPs` que retorna `addresses[0].address` |
| AC2: IP RFC1918 → throw (dns_rebinding_blocked) | ✅ CUMPLE | `validateEndpointUrl.ts:68` — `if (isBlockedHost(address)) { throw new Error(...) }` usando `BLOCKED_IPV4_PREFIXES` que incluye 10., 172.16-31., 192.168., 127. etc |
| AC3: `probeEndpoint` usa `node:https.request` con `{host: resolvedIp, servername: hostname}` | ✅ CUMPLE | `health-probe.ts:1` — `import https from 'node:https'`; `health-probe.ts:62-70` — options con `host: resolvedIp...`, `servername: urlObj.hostname` |
| AC4: DNS falla → marca `reviewing` con `dns_rebinding_blocked` | ✅ CUMPLE | `health-probe.ts:30-38` — catch block: `updateAgentHealth(..., 'reviewing', { reason: 'dns_rebinding_blocked', ... })` |
| AC5: `HealthCheckResult.reason` incluye `'dns_rebinding_blocked'` en union type | ✅ CUMPLE | `health-probe.ts:13` — `reason?: 'timeout' \| 'http_error' \| 'connection_error' \| 'ssrf_blocked' \| 'dns_rebinding_blocked'` |
| AC6: `resolvedIp = ''` → marca `reviewing` y return (guard) | ✅ CUMPLE | `health-probe.ts:41-48` — `if (!resolvedIp) { await updateAgentHealth(..., 'reviewing', { reason: 'dns_rebinding_blocked', ... }); return }` |
| AC7: IPv6 IPs usan brackets en `host` | ✅ CUMPLE | `health-probe.ts:63` — `host: resolvedIp.includes(':') ? \`[\${resolvedIp}]\` : resolvedIp,  // IPv6 requiere brackets` |

### Build: PASS
### Veredicto: ✅ QA PASS

---

## Resumen

| Issue | Veredicto | ACs CUMPLE | ACs NO CUMPLE |
|-------|-----------|-----------|---------------|
| F-03 | ✅ QA PASS | AC1, AC2 | — |
| WAS-199 | ❌ QA FAIL | AC1, AC2, AC3, AC5 | AC4 (`format_compliance_pct` ausente del response) |
| WAS-191 | ✅ QA PASS | AC1, AC2, AC3, AC4, AC5, AC6, AC7 | — |
| WAS-187 | ✅ QA PASS | AC1, AC2, AC3, AC4, AC5 | — |
| F-02 | ✅ QA PASS | AC1, AC2, AC3, AC4, AC5, AC6, AC7 | — |

### Build Gate
```
cd /home/ferdev/.openclaw/workspace/wasiai-v2 && npx tsc --noEmit
```
**Resultado: PASS** — Sin errores de compilación TypeScript.

---

### Observaciones

- **WAS-199 AC4** (`format_compliance_pct: null`): El campo no está presente en el JSON response de `route.ts`. El AC especifica que debe ser null como placeholder. Se requiere agregar `format_compliance_pct: null` al objeto retornado.
