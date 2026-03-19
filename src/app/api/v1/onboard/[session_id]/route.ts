import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { processOnboardStep } from '../step/route'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ session_id: string }> },
) {
  const { session_id } = await params
  const serviceClient = createServiceClient()

  const { data: session, error } = await serviceClient
    .from('onboarding_sessions')
    .select('current_step, status, data')
    .eq('id', session_id)
    .single()

  if (error || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  return NextResponse.json({
    current_step: session.current_step,
    status: session.status,
    completed_fields: Object.keys(session.data ?? {}),
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ session_id: string }> },
) {
  const { session_id } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { answer } = body as { answer?: unknown }

  if (answer === null || answer === undefined) {
    return NextResponse.json({ error: 'answer is required' }, { status: 400 })
  }

  return processOnboardStep(session_id, answer)
}
