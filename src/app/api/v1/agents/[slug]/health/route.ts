/**
 * GET /api/v1/agents/:slug/health
 *
 * A2A-03: Health check endpoint — agents can verify a model is live before paying.
 * Pings the upstream endpoint with a lightweight probe (no payment required).
 * Returns 200 if healthy, 503 if unreachable.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateEndpointUrl } from '@/lib/security/validateEndpointUrl'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: model } = await supabase
    .from('agents')
    .select('slug, name, status, endpoint_url')
    .eq('slug', slug)
    .eq('status', 'active')
    .single()

  if (!model) {
    return NextResponse.json(
      { slug, status: 'not_found' },
      { status: 404, headers: CORS },
    )
  }

  // Validate URL safety before probing
  try {
    validateEndpointUrl(model.endpoint_url)
  } catch {
    return NextResponse.json(
      { slug, status: 'unhealthy', reason: 'invalid_endpoint' },
      { status: 503, headers: CORS },
    )
  }

  // Lightweight ping — HEAD or POST with empty body
  const start = Date.now()
  try {
    const probe = await fetch(model.endpoint_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ping: true }),
      signal: AbortSignal.timeout(5_000), // 5s probe
    })
    const latency = Date.now() - start

    return NextResponse.json(
      {
        slug,
        name:    model.name,
        status:  probe.ok || probe.status < 500 ? 'healthy' : 'unhealthy',
        latency_ms: latency,
        upstream_status: probe.status,
      },
      { status: 200, headers: CORS },
    )
  } catch (err) {
    return NextResponse.json(
      {
        slug,
        name: model.name,
        status: 'unhealthy',
        reason: 'unreachable',
        detail: String(err),
      },
      { status: 503, headers: CORS },
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}
