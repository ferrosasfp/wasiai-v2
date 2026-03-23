/**
 * WAS-215: Async health probe for agent endpoints.
 * Fire-and-forget — never await this from a request handler.
 */
import https from 'node:https'
import { createServiceClient } from '@/lib/supabase/server'
import { validateEndpointUrlAsync } from '@/lib/security/validateEndpointUrl'

type ProbeStatus = 'active' | 'reviewing' | 'draft'

interface HealthCheckResult {
  passed: boolean
  latency_ms?: number
  reason?: 'timeout' | 'http_error' | 'connection_error' | 'ssrf_blocked' | 'dns_rebinding_blocked'
  status_code?: number
  message?: string
  fix?: string
}

export async function probeEndpoint(endpointUrl: string, agentId: string): Promise<void> {
  // SECURITY_NOTE: SERVICE_ROLE key es necesaria aquí porque el probe corre sin
  // sesión de usuario (fire-and-forget, fuera de cualquier request autenticado).
  // Necesita escribir en la tabla `agents` para actualizar el health status.
  // El scope está limitado únicamente a updates en `agents` via `.eq('id', agentId)`.
  const serviceClient = createServiceClient()

  // Step 1: SSRF check — validateEndpointUrlAsync antes de cualquier fetch
  // Doble validación intencional: anti DNS rebinding entre registro y probe
  let resolvedIp: string
  try {
    resolvedIp = await validateEndpointUrlAsync(endpointUrl)
  } catch {
    await updateAgentHealth(serviceClient, agentId, 'reviewing', {
      passed: false,
      reason: 'dns_rebinding_blocked',
      message: 'Endpoint URL is not publicly reachable.',
      fix: 'Use a publicly accessible HTTPS URL.',
    })
    return
  }

  // Guard: resolvedIp empty means DNS probe unavailable (Edge runtime) — fail-closed
  if (!resolvedIp) {
    await updateAgentHealth(serviceClient, agentId, 'reviewing', {
      passed: false,
      reason: 'dns_rebinding_blocked',
      message: 'DNS probe unavailable — endpoint cannot be verified.',
      fix: 'Use a publicly accessible HTTPS URL.',
    })
    return
  }

  // Step 2: Probe con timeout 5s — formato {"ping":true} compatible con /health existente
  // Conecta directamente a la IP validada (anti DNS rebinding) con SNI explícito
  const start = Date.now()
  await new Promise<void>((resolve) => {
    const urlObj = new URL(endpointUrl)
    const options = {
      host: resolvedIp.includes(':') ? `[${resolvedIp}]` : resolvedIp,  // IPv6 requiere brackets
      port: Number(urlObj.port) || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Host': urlObj.hostname,  // SNI y routing HTTP correcto
      },
      servername: urlObj.hostname, // TLS SNI explícito
    }
    const body = JSON.stringify({ ping: true })
    const req = https.request(options, async (res) => {
      const latency_ms = Date.now() - start
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        await updateAgentHealth(serviceClient, agentId, 'active', {
          passed: true,
          latency_ms,
        })
      } else if (res.statusCode && res.statusCode >= 400 && res.statusCode < 500) {
        // 4xx = endpoint vivo, solo rechaza el input — status reviewing
        await updateAgentHealth(serviceClient, agentId, 'reviewing', {
          passed: false,
          reason: 'http_error',
          status_code: res.statusCode,
          message: `Endpoint returned HTTP ${res.statusCode} — endpoint is live but requires valid input.`,
          fix: 'Ensure your endpoint returns HTTP 2xx for valid POST requests.',
        })
      } else {
        // 5xx = error del servidor → reviewing (WAS-277: draft → reviewing)
        await updateAgentHealth(serviceClient, agentId, 'reviewing', {
          passed: false,
          reason: 'http_error',
          status_code: res.statusCode,
          message: `Endpoint returned HTTP ${res.statusCode} — server error.`,
          fix: 'Check your server logs. Endpoint must return HTTP 2xx.',
        })
      }
      resolve()
    })
    req.setTimeout(5000, () => {
      req.destroy(new Error('timeout'))
    })
    req.on('error', async (err) => {
      const isTimeout = err.message === 'timeout'
      await updateAgentHealth(serviceClient, agentId, 'reviewing', {
        passed: false,
        reason: isTimeout ? 'timeout' : 'connection_error',
        message: isTimeout
          ? 'Endpoint did not respond within 5 seconds.'
          : 'Could not connect to the endpoint.',
        fix: 'Verify your endpoint is publicly accessible and responds within 5s.',
      })
      resolve()
    })
    req.write(body)
    req.end()
  })
}

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

async function updateAgentHealth(
  serviceClient: ReturnType<typeof createServiceClient>,
  agentId: string,
  status: ProbeStatus,
  healthCheck: HealthCheckResult,
): Promise<void> {
  await serviceClient
    .from('agents')
    .update({
      status,
      health_check: healthCheck,
      last_checked_at: new Date().toISOString(),
    })
    .eq('id', agentId)
}
