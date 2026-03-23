# SDD WAS-277 — Health check síncrono al activar agente
**Clasificación:** HU-MAJOR
**Archivos:** `src/lib/agents/health-probe.ts`, `src/app/api/creator/agents/[slug]/status/route.ts`

## Context
`probeEndpoint()` existe pero solo se llama en `register/route.ts` como fire-and-forget para ciertos auth methods. Cuando un creador hace PATCH a `/creator/agents/[slug]/status` con `status: active`, no hay ningún probe — el agente se activa sin verificar que su endpoint funcione.

**Decisión de diseño aprobada por PO:**
- El probe es **síncrono**: bloquea la request del creador hasta recibir resultado (máx 6s timeout)
- Si el probe falla: el agente queda en `reviewing` (no `draft`) — menos disruptivo
- Actualmente `health-probe.ts` usa `draft` para 5xx y timeout → **se cambia a `reviewing`** para todos los fallos

## Acceptance Criteria
- AC1: WHEN un creador hace PATCH status → `active` THEN el sistema ejecuta probe síncrono antes de confirmar
- AC2: IF el probe pasa (2xx) THEN el agente se activa y `health_check`, `last_checked_at` quedan actualizados
- AC3: IF el probe falla (4xx, 5xx, timeout, unreachable) THEN el agente queda en `reviewing`, la API responde 422 con mensaje descriptivo del fallo
- AC4: WHEN el agente no tiene `endpoint_url` THEN la activación falla con 422 "endpoint_url is required to activate"
- AC5: WHEN el agente va a `paused` o `draft` (no `active`) THEN el probe NO corre
- AC6: WHEN `probeEndpoint` falla por 5xx o timeout THEN el status resultante es `reviewing` (no `draft`)

## Wave 0 — Pre-flight
- [ ] Leer `src/lib/agents/health-probe.ts` completo
- [ ] Leer `src/app/api/creator/agents/[slug]/status/route.ts` completo
- [ ] Verificar qué otros lugares llaman `probeEndpoint`: `grep -r "probeEndpoint" src/ --include="*.ts"`
- [ ] Confirmar que `ProbeStatus` type está definido solo en `health-probe.ts`
- [ ] Build gate: `npx tsc --noEmit`

## Wave 1 — Modificar health-probe.ts: `draft` → `reviewing` + nueva función síncrona
**Archivo:** `src/lib/agents/health-probe.ts`

### 1a. Cambiar `draft` → `reviewing` en todos los casos de fallo
En los dos lugares donde se usa `'draft'`:
- `req.on('error', ...)` → cambiar `'draft'` a `'reviewing'`
- El bloque `5xx` → cambiar `'draft'` a `'reviewing'`

Resultado: `ProbeStatus` puede simplificarse a `'active' | 'reviewing'`, pero mantener `'draft'` en el type para compatibilidad con código existente que pueda usarlo.

### 1b. Exportar nueva función síncrona `probeEndpointSync`
```typescript
/**
 * WAS-277: Synchronous health probe — awaitable from request handlers.
 * Returns probe result instead of writing to DB directly.
 * Caller is responsible for DB update and response.
 */
export async function probeEndpointSync(endpointUrl: string): Promise<{
  passed: boolean
  status: 'active' | 'reviewing'
  healthCheck: HealthCheckResult
}> {
  // Step 1: SSRF check — idéntico a probeEndpoint
  let resolvedIp: string
  try {
    resolvedIp = await validateEndpointUrlAsync(endpointUrl)
  } catch {
    return {
      passed: false,
      status: 'reviewing',
      healthCheck: {
        passed: false,
        reason: 'dns_rebinding_blocked',
        message: 'Endpoint URL is not publicly reachable.',
        fix: 'Use a publicly accessible HTTPS URL.',
      },
    }
  }
  if (!resolvedIp) {
    return {
      passed: false,
      status: 'reviewing',
      healthCheck: {
        passed: false,
        reason: 'dns_rebinding_blocked',
        message: 'DNS probe unavailable.',
        fix: 'Use a publicly accessible HTTPS URL.',
      },
    }
  }

  // Step 2: Probe — misma lógica que probeEndpoint pero retorna en lugar de escribir en DB
  const start = Date.now()  // WAS-277: declarar antes del Promise para capturar latencia
  return new Promise<{ passed: boolean; status: 'active' | 'reviewing'; healthCheck: HealthCheckResult }>((resolve) => {
    const urlObj = new URL(endpointUrl)
    // Opciones idénticas a probeEndpoint — conecta a IP validada con SNI explícito (anti DNS rebinding)
    const options = {
      host:       resolvedIp.includes(':') ? `[${resolvedIp}]` : resolvedIp,
      port:       Number(urlObj.port) || 443,
      path:       urlObj.pathname + urlObj.search,
      method:     'POST',
      headers:    {
        'Content-Type': 'application/json',
        'Host':         urlObj.hostname,
      },
      servername: urlObj.hostname,
    }
    const body = JSON.stringify({ ping: true })
    const req = https.request(options, (res) => {
      const latency_ms = Date.now() - start
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        resolve({ passed: true, status: 'active', healthCheck: { passed: true, latency_ms } })
      } else {
        resolve({
          passed: false,
          status: 'reviewing',
          healthCheck: {
            passed: false,
            reason: 'http_error',
            status_code: res.statusCode,
            message: `Endpoint returned HTTP ${res.statusCode}.`,
            fix: 'Ensure your endpoint returns HTTP 2xx for POST requests.',
          },
        })
      }
    })
    req.setTimeout(5000, () => req.destroy(new Error('timeout')))
    req.on('error', (err) => {
      const isTimeout = err.message === 'timeout'
      resolve({
        passed: false,
        status: 'reviewing',
        healthCheck: {
          passed: false,
          reason: isTimeout ? 'timeout' : 'connection_error',
          message: isTimeout ? 'Endpoint did not respond within 5 seconds.' : 'Could not connect.',
          fix: 'Verify your endpoint is publicly accessible.',
        },
      })
    })
    req.write(body)
    req.end()
  })
}
```

**Build gate:** `npx tsc --noEmit`

## Wave 2 — Modificar status/route.ts para probe síncrono en activación
**Archivo:** `src/app/api/creator/agents/[slug]/status/route.ts`

Agregar import:
```typescript
import { probeEndpointSync } from '@/lib/agents/health-probe'
```

Primero, cambiar el select inicial de `status/route.ts` (línea ~51) para incluir `endpoint_url` y evitar un segundo query:

```typescript
// Antes:
.select('id, creator_id, status, registration_type')
// Después:
.select('id, creator_id, status, registration_type, endpoint_url')
```

En el bloque PATCH, antes del `serviceClient.from('agents').update(updatePayload)`, cuando `result.data.status === 'active'`:

```typescript
if (result.data.status === 'active') {
  // WAS-277: Verificar endpoint antes de activar — endpoint_url ya viene del select inicial
  if (!existing.endpoint_url) {
    return NextResponse.json(
      { error: 'endpoint_url is required to activate an agent', code: 'missing_endpoint' },
      { status: 422 },
    )
  }

  const probeResult = await probeEndpointSync(existing.endpoint_url)

  if (!probeResult.passed) {
    // Guardar resultado del probe en DB (reviewing + health_check actualizado)
    await serviceClient.from('agents').update({
      status: 'reviewing',
      health_check: probeResult.healthCheck,
      last_checked_at: new Date().toISOString(),
    }).eq('id', existing.id)

    return NextResponse.json(
      {
        error: 'Endpoint health check failed',
        code: 'endpoint_probe_failed',
        detail: probeResult.healthCheck.message,
        fix: probeResult.healthCheck.fix,
        status: 'reviewing',
      },
      { status: 422 },
    )
  }

  // Probe passed — incluir health_check en el update
  updatePayload.health_check = probeResult.healthCheck
  updatePayload.last_checked_at = new Date().toISOString()
}
```

**Build gate:** `npx tsc --noEmit`

## Wave 3 — Verificar register/route.ts
- Confirmar que el probe fire-and-forget existente en `register/route.ts` sigue funcionando
- No modificar su comportamiento — ese path usa `probeEndpoint` (async fire-and-forget) que también se actualiza en Wave 1 (`draft` → `reviewing`)
- Si hay algún import roto, corregir

**Build gate:** `npx tsc --noEmit` + `grep -r "probeEndpoint\b" src/ --include="*.ts"` para confirmar que todos los call sites compilan

## Rollback
```bash
git revert HEAD  # o los dos commits si se separan por archivo
```
Sin migraciones de DB — los campos `health_check`, `last_checked_at` ya existen.

## Critical Constraints
- PROHIBIDO que el probe corra cuando status → `paused` o `draft`
- OBLIGATORIO que todos los fallos de probe dejen el agente en `reviewing`, nunca en `draft`
- PROHIBIDO await `probeEndpointSync` desde middleware Edge — solo Node.js runtime
- OBLIGATORIO que el timeout del probe sea máximo 6 segundos (AbortSignal o req.setTimeout)
- NO modificar la firma pública de `probeEndpoint` (función existente) — solo agregar `probeEndpointSync`
