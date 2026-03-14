/**
 * WAS-215: Async health probe for agent endpoints.
 * Fire-and-forget — never await this from a request handler.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { validateEndpointUrlAsync } from '@/lib/security/validateEndpointUrl'

type ProbeStatus = 'active' | 'reviewing'

interface HealthCheckResult {
  passed: boolean
  latency_ms?: number
  reason?: 'timeout' | 'http_error' | 'connection_error' | 'ssrf_blocked'
  status_code?: number
  message?: string
  fix?: string
}

export async function probeEndpoint(endpointUrl: string, agentId: string): Promise<void> {
  const serviceClient = createServiceClient()

  // Step 1: SSRF check — validateEndpointUrlAsync antes de cualquier fetch
  // Doble validación intencional: anti DNS rebinding entre registro y probe
  try {
    await validateEndpointUrlAsync(endpointUrl)
  } catch {
    await updateAgentHealth(serviceClient, agentId, 'reviewing', {
      passed: false,
      reason: 'ssrf_blocked',
      message: 'Endpoint URL is not publicly reachable.',
      fix: 'Use a publicly accessible HTTPS URL.',
    })
    return
  }

  // Step 2: Probe con timeout 5s — formato {"ping":true} compatible con /health existente
  const start = Date.now()
  try {
    const res = await fetch(endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ping: true }),
      signal: AbortSignal.timeout(5_000),
    })
    const latency_ms = Date.now() - start

    if (res.ok) {  // AC2: only 2xx counts as alive
      await updateAgentHealth(serviceClient, agentId, 'active', {
        passed: true,
        latency_ms,
      })
    } else {
      await updateAgentHealth(serviceClient, agentId, 'reviewing', {
        passed: false,
        reason: 'http_error',
        status_code: res.status,
        message: `Endpoint returned HTTP ${res.status}.`,
        fix: 'Ensure your endpoint returns HTTP 2xx for POST requests.',
      })
    }
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === 'TimeoutError'
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
