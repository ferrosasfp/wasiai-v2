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
import { handleInvoke } from '@/lib/invoke/handleInvoke'

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

  // H-5 (WKH-AUDIT-V2): resolver in-process — sin self-call HTTP ni NEXT_PUBLIC_SITE_URL.
  // handleInvoke autentica leyendo x-agent-key; aquí la key viene en X-API-Key, así que
  // se clona el request agregando ese header antes de delegar.
  const fwdHeaders = new Headers(request.headers)
  fwdHeaders.set('x-agent-key', apiKey)
  const clonedBody = await request.clone().text()
  const fwdRequest = new NextRequest(request.url, {
    method: 'POST',
    headers: fwdHeaders,
    body: clonedBody || '{}',
  })

  const res = await handleInvoke(fwdRequest, slug)

  // Re-emitir respuesta con CORS (mismo shape que hoy)
  const text = await res.text()
  return new NextResponse(text, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'application/json',
      ...CORS,
    },
  })
}
