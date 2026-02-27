/**
 * POST /api/v1/agents/[slug]/invoke
 *
 * Thin proxy to the canonical invoke endpoint at /api/v1/models/[slug]/invoke.
 * Accepts the X-API-Key header (maps to x-agent-key) so TryIt and external
 * integrations can call agents without knowing the internal /models path.
 *
 * NOTE: Agent existence / status validation is delegated to the canonical
 * endpoint which returns 404/503 accordingly — no double DB lookup here.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  // Map X-API-Key → x-agent-key and forward to canonical invoke endpoint
  const apiKey = request.headers.get('X-API-Key') ?? request.headers.get('x-api-key')

  if (!apiKey) {
    // HU-3.3: Verificar si el agente tiene free trial activo antes de responder
    const svc = createServiceClient()
    const { data: agentMeta } = await svc
      .from('agents')
      .select('free_trial_enabled')
      .eq('slug', slug)
      .eq('status', 'active')
      .single()

    if (!agentMeta?.free_trial_enabled) {
      return NextResponse.json(
        {
          error:   'payment_required',
          message: 'Free trial not available for this agent. An API key with funds is required.',
        },
        { status: 402, headers: CORS },
      )
    }

    // Trial disponible — guiar al cliente al endpoint correcto
    return NextResponse.json(
      {
        error:          'use_trial_endpoint',
        message:        'Use POST /api/v1/agents/{slug}/trial for free trial invocations.',
        trial_endpoint: `/api/v1/agents/${slug}/trial`,
      },
      { status: 402, headers: CORS },
    )
  }

  // Forward the request to the canonical /api/v1/models/[slug]/invoke
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').trim().replace(/\/$/, '')
  const invokeUrl = `${siteUrl}/api/v1/models/${encodeURIComponent(slug)}/invoke`

  let body: string
  try {
    body = await request.text()
  } catch {
    body = '{}'
  }

  let upstream: Response
  try {
    upstream = await fetch(invokeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-key':  apiKey,
      },
      body: body || '{}',
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    return NextResponse.json(
      { error: 'invoke_proxy_error', message: 'Failed to reach invoke endpoint' },
      { status: 502, headers: CORS },
    )
  }

  const responseText = await upstream.text()

  return new NextResponse(responseText, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      ...CORS,
    },
  })
}
