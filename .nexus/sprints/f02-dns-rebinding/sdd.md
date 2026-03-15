# SDD F-02: [BUGFIX] DNS Rebinding en health-probe

> SPEC_APPROVED: no
> Fecha: 2026-03-14
> Tipo: bugfix / security
> SDD_MODE: bugfix
> Branch: fix/f02-dns-rebinding-probe

---

## 1. Resumen del bug

`probeEndpoint` en `health-probe.ts` llama a `validateEndpointUrlAsync(endpointUrl)` que resuelve el hostname DNS y valida que las IPs sean públicas. Sin embargo, inmediatamente después hace `fetch(endpointUrl)` usando la URL original — el OS vuelve a resolver el hostname en el momento del fetch. Entre la validación y el fetch existe una ventana donde un atacante puede cambiar el DNS para que resuelva a una IP interna (127.0.0.1, 192.168.x.x, etc.) y así hacer que el servidor probe endpoints internos.

**Impacto:** Un creador malicioso podría registrar un agente con endpoint `https://attacker.com/` que en el momento de la validación DNS apunta a una IP pública, pero cambia su DNS justo antes del fetch para que apunte a `169.254.169.254` (AWS metadata) u otro endpoint interno.

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | F-02 |
| **Tipo** | bugfix / security |
| **Objetivo** | Eliminar la ventana de DNS rebinding en `probeEndpoint` usando la IP ya resuelta para el fetch |
| **Scope IN** | `src/lib/security/validateEndpointUrl.ts`, `src/lib/agents/health-probe.ts` |
| **Scope OUT** | Otros usos de `validateEndpointUrlAsync` fuera del probe, Edge runtime routes |

## 3. Reproducción

### Repro steps
1. Registrar agente con endpoint `https://attacker.com/`
2. En el momento de la validación, `attacker.com` resuelve a IP pública válida
3. Antes de que el `fetch` se ejecute, cambiar DNS de `attacker.com` a `127.0.0.1`
4. `fetch(endpointUrl)` conecta a `127.0.0.1` o `169.254.169.254`

### Actual
El probe hace 2 resoluciones DNS: una en `validateResolvedIPs` y otra implícita en `fetch()`.

### Expected
El probe hace 1 resolución DNS y usa esa IP para conectar.

## 4. Context Map

### Archivos leídos
| Archivo | Por qué | Hallazgo |
|---------|---------|----------|
| `src/lib/agents/health-probe.ts` | Archivo con el bug | `fetch(endpointUrl)` re-resuelve DNS después de validación |
| `src/lib/security/validateEndpointUrl.ts` | Función de validación | `validateResolvedIPs` resuelve pero no retorna la IP; `validateEndpointUrlAsync` retorna `void` |

### Exemplar para el fix
| Fix en | Seguir patrón de | Razón |
|--------|-----------------|-------|
| `validateEndpointUrl.ts` | Mismo archivo — `validateResolvedIPs` | Extender para retornar IP validada |
| `health-probe.ts` | Mismo archivo | Usar IP retornada en fetch |

## 5. Análisis de causa raíz

### Dónde está el bug
| Archivo | Línea/zona | Qué está mal |
|---------|-----------|-------------|
| `src/lib/security/validateEndpointUrl.ts` | `validateResolvedIPs` | Resuelve IP pero retorna `void` en lugar de la primera IP válida |
| `src/lib/security/validateEndpointUrl.ts` | `validateEndpointUrlAsync` | Retorna `Promise<void>` en lugar de `Promise<string>` (IP resuelta) |
| `src/lib/agents/health-probe.ts` | línea `const res = await fetch(endpointUrl, ...)` | Usa URL original → re-resolución DNS |

### Causa raíz
`validateEndpointUrlAsync` valida la IP pero la descarta. El llamador no tiene forma de saber qué IP se validó y no puede usarla para el fetch.

### Fix propuesto
1. Modificar `validateResolvedIPs` para retornar `Promise<string>` (la primera IP validada)
2. Modificar `validateEndpointUrlAsync` para retornar `Promise<string>` (la IP)
3. En `probeEndpoint`: capturar la IP y usar `node:https` con `options.host = resolvedIp` + `options.servername = hostname` (SNI correcto) + `options.port` — esto conecta TCP a la IP validada pero el TLS handshake usa el hostname original para SNI. NO usar `fetch()` con URL de IP (TLS cert mismatch).
4. Mantener backward compat: los callers existentes que ignoran el retorno siguen funcionando
5. Cambiar `reason: 'ssrf_blocked'` a `reason: 'dns_rebinding_blocked'` cuando la IP validada es interna
6. Añadir `'dns_rebinding_blocked'` al union type `HealthCheckResult.reason`

## 6. Acceptance Criteria (EARS)

1. WHEN `validateEndpointUrlAsync` es llamado con una URL válida, THE función SHALL retornar la primera IP pública resuelta como `string`
2. WHEN `validateEndpointUrlAsync` es llamado con URL cuyo hostname resuelve a IP RFC1918, THE función SHALL throw con código `dns_rebinding_blocked`
3. WHEN `probeEndpoint` ejecuta la conexión, THE SHALL usar `node:https.request` con `{ host: resolvedIp, servername: hostname, port: 443 }` en lugar de `fetch(endpointUrl)` — así TCP conecta a la IP validada y TLS usa el hostname correcto para SNI
4. WHEN DNS resolution falla (NXDOMAIN, timeout), THE probe SHALL marcar agente como `reviewing` con `reason: 'dns_rebinding_blocked'`
5. WHEN callers existentes de `validateEndpointUrlAsync` ignoran el valor de retorno, THE comportamiento SHALL ser idéntico al actual (no breaking)
6. WHEN el hostname tiene puerto no-443, THE `node:https.request` SHALL usar ese puerto en `options.port`
7. WHEN `HealthCheckResult.reason` es usado en TypeScript, THE union SHALL incluir `'dns_rebinding_blocked'`

## 7. Constraint Directives

### OBLIGATORIO
- Usar `node:https.request` con `{ host: resolvedIp, servername: hostname, port }` — NO usar `fetch()` con URL de IP (TLS cert mismatch)
- Para IPv6: wrappear la IP en corchetes en `options.host` si es IPv6
- Añadir `'dns_rebinding_blocked'` al union type `reason` en `HealthCheckResult` en `health-probe.ts`
- El body del request debe ser `JSON.stringify({ ping: true })` con `Content-Type: application/json` (igual que antes)
- Timeout de 5s via `req.setTimeout(5_000, () => req.destroy())`

### PROHIBIDO
- NO usar `fetch("https://<IP>/...")` — TLS handshake fallará porque el cert es del dominio, no de la IP
- NO cambiar la firma de `validateEndpointUrl` (versión síncrona) — solo `validateEndpointUrlAsync`
- NO modificar routes que usen `validateEndpointUrlAsync` fuera de `health-probe.ts`
- NO usar `dns.resolve` — usar `dns.lookup` (ya existente)
- NO cambiar la clasificación de errores `ssrf_blocked` existentes

## 8. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|-----------|
| TLS handshake falla si SNI no coincide con IP | Media | Alto | Header `Host:` correcto + SNI via hostname en `tls.connect` no aplica para `fetch` estándar — los servidores con SNI estricto pueden fallar; aceptado como tradeoff de seguridad vs funcionalidad |
| CDNs con múltiples IPs — IP puede cambiar entre requests | Baja | Bajo | Probe es fire-and-forget, una sola request; no hay sesión que mantener |

## 9. Dependencias
- Ninguna externa

---

*SDD generado por NexusAgil — BUGFIX*
