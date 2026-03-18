import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

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
