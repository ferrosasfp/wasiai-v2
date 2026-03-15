# Logic Audit — Sprint 5
> Auditor: NexusAgil Logic Auditor v1.3
> Fecha: 2026-03-14
> Commits auditados: F-03 `4b0c789`, WAS-199 `e2475db`, WAS-191 `659251d`, WAS-187 `de42329`, F-02 `a8cd00b`

---

## F-03 — SECURITY_NOTE en `probeEndpoint`

### AC Trazabilidad

| AC | Descripción | Estado |
|----|-------------|--------|
| AC-1 | Comentario `// SECURITY_NOTE:` presente antes de `createServiceClient()` | ✅ |
| AC-1a | Explica que el probe corre sin sesión de usuario | ✅ |
| AC-1b | Explica que necesita escribir en `agents` para actualizar health status | ✅ |
| AC-1c | Explica que el scope está limitado a updates vía `.eq('id', agentId)` | ✅ |
| AC-2 | El comentario está **dentro** de la función `probeEndpoint` (no a nivel de módulo) | ✅ |

### Findings

El comentario SECURITY_NOTE existe en `health-probe.ts` líneas 21-25, correctamente posicionado dentro de `probeEndpoint`, antes de `const serviceClient = createServiceClient()`. Cubre los tres puntos exigidos. Sin hallazgos adicionales.

### Veredicto: ✅ APROBADO

---

## WAS-199 — `/reputation` endpoint gaps

### AC Trazabilidad

| AC | Descripción | Estado |
|----|-------------|--------|
| SELECT incluye `performance_score` | Columna añadida al `.select(...)` | ✅ |
| SELECT incluye `reputation_count` | Columna añadida al `.select(...)` | ✅ |
| `performance_score` en response | `agent.performance_score ?? null` | ✅ |
| `reputation_score` en response (votos 0-1) | `agent.reputation_score ?? null` | ✅ |
| `reputation_count` en response | `agent.reputation_count ?? 0` | ✅ |
| `erc8004_score = reputation_score` | `agent.reputation_score ?? null` | ✅ |
| Campos existentes no modificados | `score`, `p50_ms`, `p95_ms`, `trend`, etc. inalterados | ✅ |

### Findings

**1. `reputation_count ?? 0` — correcto.**
`reputation_count` es `INT` en DB. Puede ser `null` si el registro precede a la migración (agentes legacy). El `?? 0` es el comportamiento correcto según SDD sección 4.5.

**2. `erc8004_score = agent.reputation_score ?? null` — escala correcta.**
El SDD documenta explícitamente que `reputation_score` en la tabla `agents` es `DECIMAL(3,2)` (0–1). El field se expone directamente sin transformación, que es lo esperado. Cuando WAS-194 implemente on-chain, se actualizará. No hay bug.

**3. Ambigüedad de nombres manejada con comentarios inline.**
Los tres campos (`score`, `performance_score`, `reputation_score`) están comentados en el response JSON, mitigando el riesgo documentado en la sección 7 del SDD.

**4. Sin scope creep.** `format_compliance_pct` sigue como `null` placeholder. Rate limiter y `calcScore()` no fueron tocados.

### Veredicto: ✅ APROBADO

---

## WAS-191 — `PerformanceBadge` UI

### AC Trazabilidad

| AC | Descripción | Estado |
|----|-------------|--------|
| `performance_score?: number \| null` en `Model` type | Añadido en `models.types.ts` | ✅ |
| Componente `PerformanceBadge.tsx` creado | Existe en `src/features/reputation/components/` | ✅ |
| `'use client'` en componente | Presente | ✅ |
| `score === null` → retorna `null` | Verificado | ✅ |
| `score >= 90` → verde | Correcto. Boundary 90 cae en verde | ✅ |
| `score >= 70` → amarillo | Correcto | ✅ |
| `score < 70` → rojo | Correcto | ✅ |
| Display `"Performance: {score}/100"` | Implementado vía i18n label + `{score}/100` | ✅ |
| Renderizado en `page.tsx` | `<PerformanceBadge score={model.performance_score ?? null} />` | ✅ |

### Findings

**1. Boundary `score >= 90`: CORRECTO.**
Exactamente 90 → verde. Coincide con la especificación del SDD. Sin off-by-one.

**2. Tipo string desde Supabase — riesgo mitigado.**
Supabase retorna columnas `DECIMAL(5,1)` como `number` en JS (no string). El tipo TypeScript `performance_score?: number | null` es correcto. Si en algún escenario inesperado llegara como string, la comparación `>= 90` en JS haría coerción implícita (`"94.5" >= 90 → true`) — comportamiento correcto aunque no robusto. En producción con Supabase JS client v2 esto no ocurre.

**3. Guarda adicional `score === undefined`.**
El componente verifica `score === null || score === undefined`. El tipo del prop es `number | null`, pero dado que `performance_score` en `Model` es opcional (`?`), puede llegar como `undefined`. El guard extra es correcto y defensivo.

**4. ⚠️ Desviación de layout: componente NO está en la misma fila que `AgentRating`.**
El SDD especifica explícitamente: *"Junto al AgentRating existente — misma fila, separado por un divisor visual (`|` o gap)."* En `page.tsx`, `PerformanceBadge` y `AgentRating` son elementos hermanos en un `div.space-y-4` (columna vertical), no en la misma fila. El badge está **sobre** el rating, no **al lado**. Esto es una desviación de UI, no un bug lógico. No bloquea funcionalidad pero incumple el AC de layout.

**5. Sin scope creep.** `getModelBySlug` y `AgentRating.tsx` no fueron modificados.

### Veredicto: ✅ APROBADO con observación
> **Observación (no bloqueante):** Layout incumple "misma fila" del SDD. Funcionalidad lógica correcta. Documentar como deuda de UI si el equipo lo considera relevante.

---

## WAS-187 — `discoverAgent` ranking

### AC Trazabilidad

| AC | Descripción | Estado |
|----|-------------|--------|
| `min_performance?: number` en `DiscoveryConstraints` | Presente | ✅ |
| `performance_score?: number \| null` en `DiscoveredAgent` | Presente | ✅ |
| `performance_score` en SELECT | Añadido al `.select(...)` | ✅ |
| Filtro `min_performance` → `.gte('performance_score', x)` | Implementado | ✅ |
| Order: `performance_score DESC NULLS LAST` primero | `.order('performance_score', { ascending: false, nullsFirst: false })` | ✅ |
| Order: `reputation_score DESC NULLS LAST` segundo | `.order('reputation_score', { ascending: false, nullsFirst: false })` | ✅ |
| Order: `price_per_call ASC` tercero | `.order('price_per_call', { ascending: true })` | ✅ |
| `min_reputation` sigue funcionando sin cambios semánticos | ✅ | ✅ |

### Findings

**1. `nullsFirst: false` en Supabase — comportamiento confirmado.**
Supabase JS Client traduce `nullsFirst: false` a `ORDER BY campo DESC NULLS LAST` en PostgreSQL. Los NULLs van **al final**, que es lo esperado. Cuando todos los candidatos tienen `performance_score = null`, el criterio secundario (`reputation_score`) decide. ✅

**2. `.gte('performance_score', x)` con campo null — comportamiento de PostgreSQL correcto.**
En PostgreSQL, cualquier comparación con NULL retorna NULL (no true/false). Supabase `.gte()` genera `WHERE performance_score >= x`. Filas con `performance_score IS NULL` son excluidas automáticamente. Esto es el comportamiento deseado según SDD sección 4.8: *"retorna null → compose retorna no_agent_match"*. ✅

**3. `performance_score` en `DiscoveredAgent` es opcional (`?`).**
El SDD muestra la firma como `performance_score: number | null` (requerida), pero la implementación usa `performance_score?: number | null` (opcional). En la práctica el campo siempre viene del SELECT, por lo que será `number | null`, nunca `undefined`. Desviación menor de tipo TypeScript, sin impacto en runtime.

**4. Sin scope creep.** `compose/route.ts` y `GET /api/v1/agents/discover` no fueron modificados.

### Veredicto: ✅ APROBADO

---

## F-02 — DNS Rebinding en `health-probe`

### AC Trazabilidad

| AC | Descripción | Estado |
|----|-------------|--------|
| AC-1 | `validateEndpointUrlAsync` retorna `Promise<string>` (IP) | ✅ |
| AC-2 | `validateEndpointUrlAsync` lanza con `dns_rebinding_blocked` si IP es RFC1918 | ✅ (via throw que captura `probeEndpoint`) |
| AC-3 | `probeEndpoint` usa `node:https.request` con `{ host: resolvedIp, servername: hostname }` | ✅ |
| AC-4 | DNS failure → agente marcado `reviewing` con `reason: 'dns_rebinding_blocked'` | ✅ |
| AC-5 | Callers existentes que ignoran retorno siguen funcionando | ✅ |
| AC-6 | Puerto no-443 usa `Number(urlObj.port) \|\| 443` | ✅ |
| AC-7 | `'dns_rebinding_blocked'` en union type `HealthCheckResult.reason` | ✅ |

### Findings

**1. 🔴 BUG BLOQUEANTE: `resolvedIp` puede ser `''` → conexión a localhost implícita**

En `validateResolvedIPs` existe un catch-all al final:
```typescript
// Module not available (Edge runtime) — skip probe silently, return empty string
return ''
```

Este `return ''` solo está pensado para Edge runtime (fallo de `import('node:dns/promises')`). Sin embargo, **puede activarse en Node.js** si ocurre cualquier error inesperado que no coincida con los patrones conocidos (`private or internal`, `ENOTFOUND`, `ETIMEOUT`, `EAI_AGAIN`, `No addresses resolved`). Por ejemplo: un error de permisos del sistema, un error de red atípico, un error de proxy DNS, etc.

Cuando `resolvedIp = ''`, el código en `health-probe.ts` continúa:
```typescript
const options = {
  host: resolvedIp,  // = ''
  ...
}
```

**Node.js `https.request({ host: '' })` se comporta como `host: 'localhost'`** (valor por defecto cuando host es falsy). Esto significa que el probe conectaría a `localhost:443` en el servidor, **exactamente el vector SSRF que F-02 intenta prevenir**.

**Mitigación requerida:** En `probeEndpoint`, después de obtener `resolvedIp`, validar que no esté vacío:
```typescript
resolvedIp = await validateEndpointUrlAsync(endpointUrl)
if (!resolvedIp) {
  await updateAgentHealth(serviceClient, agentId, 'reviewing', {
    passed: false,
    reason: 'dns_rebinding_blocked',
    message: 'DNS probe unavailable — endpoint cannot be verified.',
    fix: 'Use a publicly accessible HTTPS URL.',
  })
  return
}
```

Alternativamente, cambiar el catch-all en `validateResolvedIPs` para que **no** retorne `''` en errores inesperados de Node.js runtime (solo retornar `''` cuando se pueda confirmar que es Edge runtime, p.ej. verificando el tipo de error de import).

---

**2. ✅ Promise wrapper — doble resolución manejada correctamente**

`resolve()` es llamado tanto en el response callback (éxito) como en `req.on('error')`. `Promise` ignora resoluciones múltiples — solo la primera cuenta. Si `req.on('error')` se dispara después del response, `resolve()` se llama dos veces pero sin efecto. El `updateAgentHealth` en el error handler sí ejecutaría un update adicional a DB, pero en la práctica TCP errors post-response son extremadamente raros en Node.js. No es un bug bloqueante, pero sí una doble escritura teórica.

---

**3. ✅ `req.setTimeout` — flujo correcto**

```typescript
req.setTimeout(5000, () => {
  req.destroy(new Error('timeout'))
})
```

`req.destroy(new Error('timeout'))` dispara `req.on('error')` con `err.message === 'timeout'`. El error handler llama `resolve()`. La cadena `timeout → destroy → error → resolve()` es correcta. El SDD preguntaba si se llama `resolve()` directamente en el timeout callback — no, se llama indirectamente vía el error handler, que es el patrón correcto.

---

**4. ✅ `resolvedIp` en Edge runtime — `node:https` también falla**

En Edge runtime, el import top-level `import https from 'node:https'` haría que `health-probe.ts` fallara al cargar el módulo. Por lo tanto, el escenario de `resolvedIp = ''` seguido de `https.request({host: ''})` no puede ocurrir en Edge runtime — el módulo no cargaría. El bug real es en Node.js con errores inesperados (Finding #1).

### Veredicto: 🔴 REQUIERE CORRECCIÓN
> **Bloqueante:** Si `validateEndpointUrlAsync` retorna `''` por un error inesperado en Node.js runtime, `https.request({host: ''})` conecta a localhost, creando una vulnerabilidad SSRF. Se debe añadir un guard `if (!resolvedIp)` en `probeEndpoint` antes de construir el request.

---

## Resumen

| Issue | Veredicto | Bloqueantes |
|-------|-----------|-------------|
| **F-03** — SECURITY_NOTE | ✅ APROBADO | Ninguno |
| **WAS-199** — /reputation gaps | ✅ APROBADO | Ninguno |
| **WAS-191** — PerformanceBadge | ✅ APROBADO con observación | Ninguno (layout desviación no bloqueante) |
| **WAS-187** — discoverAgent ranking | ✅ APROBADO | Ninguno |
| **F-02** — DNS Rebinding | 🔴 REQUIERE CORRECCIÓN | `resolvedIp = ''` → SSRF bypass vía localhost |

### Acción requerida antes de merge

**F-02:** Añadir en `probeEndpoint` (`health-probe.ts`), después de obtener `resolvedIp`:

```typescript
if (!resolvedIp) {
  await updateAgentHealth(serviceClient, agentId, 'reviewing', {
    passed: false,
    reason: 'dns_rebinding_blocked',
    message: 'DNS probe unavailable — endpoint cannot be verified.',
    fix: 'Use a publicly accessible HTTPS URL.',
  })
  return
}
```

Esta corrección es mínima (5 líneas), no cambia ninguna otra lógica, y cierra el vector SSRF residual.
