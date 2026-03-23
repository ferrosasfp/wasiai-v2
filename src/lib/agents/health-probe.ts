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

/**
 * Probe a single URL via HTTPS.
 * Returns { statusCode, latency_ms } or throws on connection error/timeout.
 */
function httpsProbe(
  resolvedIp: string,
  hostname: string,
  port: number,
  path: string,
  method: 'GET' | 'POST',
  body?: string,
  timeoutMs = 5000,
): Promise<{ statusCode: number; latency_ms: number }> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const options = {
      host:       resolvedIp.includes(':') ? `[${resolvedIp}]` : resolvedIp,
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Host':         hostname,
        ...(body ? { 'Content-Length': Buffer.byteLength(body).toString() } : {}),
      },
      servername: hostname,
    }
    const req = https.request(options, (res) => {
      res.resume() // drain
      resolve({ statusCode: res.statusCode ?? 0, latency_ms: Date.now() - start })
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

/**
 * Try GET <origin>/health as a fallback when the main endpoint returns 4xx.
 * Returns true if /health responds 2xx, false otherwise.
 */
async function probeHealthEndpoint(endpointUrl: string, resolvedIp: string): Promise<boolean> {
  try {
    const urlObj = new URL(endpointUrl)
    const port = Number(urlObj.port) || 443
    const { statusCode } = await httpsProbe(resolvedIp, urlObj.hostname, port, '/health', 'GET', undefined, 4000)
    return statusCode >= 200 && statusCode < 300
  } catch {
    return false
  }
}

export async function probeEndpoint(endpointUrl: string, agentId: string): Promise<void> {
  // SECURITY_NOTE: SERVICE_ROLE key es necesaria aquí porque el probe corre sin
  // sesión de usuario (fire-and-forget, fuera de cualquier request autenticado).
  const serviceClient = createServiceClient()

  // Step 1: SSRF check
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
  if (!resolvedIp) {
    await updateAgentHealth(serviceClient, agentId, 'reviewing', {
      passed: false,
      reason: 'dns_rebinding_blocked',
      message: 'DNS probe unavailable — endpoint cannot be verified.',
      fix: 'Use a publicly accessible HTTPS URL.',
    })
    return
  }

  // Step 2: POST probe
  try {
    const urlObj = new URL(endpointUrl)
    const port = Number(urlObj.port) || 443
    const { statusCode, latency_ms } = await httpsProbe(
      resolvedIp, urlObj.hostname, port,
      urlObj.pathname + urlObj.search,
      'POST', JSON.stringify({ ping: true }),
    )

    if (statusCode >= 200 && statusCode < 300) {
      await updateAgentHealth(serviceClient, agentId, 'active', { passed: true, latency_ms })
      return
    }

    if (statusCode >= 400 && statusCode < 500) {
      // 4xx — endpoint vivo pero rechaza input. Intentar GET /health como fallback.
      const healthOk = await probeHealthEndpoint(endpointUrl, resolvedIp)
      if (healthOk) {
        await updateAgentHealth(serviceClient, agentId, 'active', { passed: true, latency_ms })
        return
      }
      await updateAgentHealth(serviceClient, agentId, 'reviewing', {
        passed: false,
        reason: 'http_error',
        status_code: statusCode,
        message: `Endpoint returned HTTP ${statusCode}.`,
        fix: 'Ensure your endpoint returns HTTP 2xx, or expose a public GET /health endpoint.',
      })
      return
    }

    // 5xx
    await updateAgentHealth(serviceClient, agentId, 'reviewing', {
      passed: false,
      reason: 'http_error',
      status_code: statusCode,
      message: `Endpoint returned HTTP ${statusCode} — server error.`,
      fix: 'Check your server logs. Endpoint must return HTTP 2xx.',
    })
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === 'timeout'
    await updateAgentHealth(serviceClient, agentId, 'reviewing', {
      passed: false,
      reason: isTimeout ? 'timeout' : 'connection_error',
      message: isTimeout
        ? 'Endpoint did not respond within 5 seconds.'
        : 'Could not connect to the endpoint.',
      fix: 'Verify your endpoint is publicly accessible and responds within 5s.',
    })
  }
}

/**
 * WAS-277: Synchronous health probe — awaitable from request handlers.
 */
export async function probeEndpointSync(endpointUrl: string): Promise<{
  passed: boolean
  status: 'active' | 'reviewing'
  healthCheck: HealthCheckResult
}> {
  // Step 1: SSRF check
  let resolvedIp: string
  try {
    resolvedIp = await validateEndpointUrlAsync(endpointUrl)
  } catch {
    return {
      passed: false, status: 'reviewing',
      healthCheck: { passed: false, reason: 'dns_rebinding_blocked', message: 'Endpoint URL is not publicly reachable.', fix: 'Use a publicly accessible HTTPS URL.' },
    }
  }
  if (!resolvedIp) {
    return {
      passed: false, status: 'reviewing',
      healthCheck: { passed: false, reason: 'dns_rebinding_blocked', message: 'DNS probe unavailable.', fix: 'Use a publicly accessible HTTPS URL.' },
    }
  }

  // Step 2: POST probe
  try {
    const urlObj = new URL(endpointUrl)
    const port = Number(urlObj.port) || 443
    const { statusCode, latency_ms } = await httpsProbe(
      resolvedIp, urlObj.hostname, port,
      urlObj.pathname + urlObj.search,
      'POST', JSON.stringify({ ping: true }),
    )

    if (statusCode >= 200 && statusCode < 300) {
      return { passed: true, status: 'active', healthCheck: { passed: true, latency_ms } }
    }

    if (statusCode >= 400 && statusCode < 500) {
      // 4xx — intentar GET /health como fallback
      const healthOk = await probeHealthEndpoint(endpointUrl, resolvedIp)
      if (healthOk) {
        return { passed: true, status: 'active', healthCheck: { passed: true, latency_ms } }
      }
      return {
        passed: false, status: 'reviewing',
        healthCheck: {
          passed: false, reason: 'http_error', status_code: statusCode,
          message: `Endpoint returned HTTP ${statusCode}.`,
          fix: 'Ensure your endpoint returns HTTP 2xx, or expose a public GET /health endpoint.',
        },
      }
    }

    return {
      passed: false, status: 'reviewing',
      healthCheck: {
        passed: false, reason: 'http_error', status_code: statusCode,
        message: `Endpoint returned HTTP ${statusCode}.`,
        fix: 'Ensure your endpoint returns HTTP 2xx for POST requests.',
      },
    }
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === 'timeout'
    return {
      passed: false, status: 'reviewing',
      healthCheck: {
        passed: false,
        reason: isTimeout ? 'timeout' : 'connection_error',
        message: isTimeout ? 'Endpoint did not respond within 5 seconds.' : 'Could not connect.',
        fix: 'Verify your endpoint is publicly accessible.',
      },
    }
  }
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
