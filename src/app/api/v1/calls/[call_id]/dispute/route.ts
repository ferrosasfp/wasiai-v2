/**
 * POST /api/v1/calls/:call_id/dispute
 * WAS-189: Abrir dispute sobre una invocación
 * Auth: x-api-key (caller key)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'

const VALID_REASONS = ['bad_output', 'timeout', 'no_response', 'other'] as const
type DisputeReason = typeof VALID_REASONS[number]

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ call_id: string }> },
) {
  const { call_id } = await params

  // 1. Validate auth (x-api-key → key_id)
  const rawApiKey = request.headers.get('x-api-key')
  if (!rawApiKey) {
    return NextResponse.json({ error: 'Missing x-api-key header', code: 'missing_key' }, { status: 401 })
  }

  const keyHash = createHash('sha256').update(rawApiKey).digest('hex')
  const supabase = createServiceClient()

  const { data: keyRow, error: keyError } = await supabase
    .from('agent_keys')
    .select('id, is_active')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single()

  if (keyError || !keyRow) {
    return NextResponse.json({ error: 'Invalid or inactive API key', code: 'invalid_key' }, { status: 401 })
  }

  // 2. Parse and validate body
  let body: { reason?: unknown; description?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'invalid_body' }, { status: 400 })
  }

  const reason = body.reason as string | undefined
  if (!reason || !(VALID_REASONS as readonly string[]).includes(reason)) {
    return NextResponse.json(
      {
        error: 'Invalid reason',
        code: 'invalid_reason',
        valid_reasons: VALID_REASONS,
      },
      { status: 422 },
    )
  }

  const description = body.description as string | undefined
  if (description !== undefined && description.length > 500) {
    return NextResponse.json(
      { error: 'description must be 500 characters or less', code: 'description_too_long' },
      { status: 422 },
    )
  }

  // 3. Lookup agent_call by call_id — verify ownership
  const { data: agentCall, error: callError } = await supabase
    .from('agent_calls')
    .select('id, agent_id, key_id')
    .eq('id', call_id)
    .single()

  if (callError || !agentCall) {
    return NextResponse.json({ error: 'Call not found', code: 'call_not_found' }, { status: 404 })
  }

  if (agentCall.key_id !== keyRow.id) {
    return NextResponse.json(
      { error: 'This call does not belong to your API key', code: 'forbidden' },
      { status: 403 },
    )
  }

  // 4. Insert dispute — unique constraint on call_id → 409 if duplicate
  const { data: dispute, error: insertError } = await supabase
    .from('disputes')
    .insert({
      call_id,
      agent_id: agentCall.agent_id,
      caller_key_id: keyRow.id,
      reason: reason as DisputeReason,
      description: description ?? null,
    })
    .select('id')
    .single()

  if (insertError) {
    // 23505 = unique_violation — dispute already exists for this call
    if ((insertError as { code?: string }).code === '23505') {
      return NextResponse.json(
        { error: 'A dispute already exists for this call', code: 'dispute_already_exists' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: 'Failed to create dispute', code: 'internal_error' }, { status: 500 })
  }

  // 5. Return 201
  return NextResponse.json(
    {
      dispute_id: dispute.id,
      status: 'open',
      message: 'Dispute submitted. WasiAI will review within 48h.',
    },
    { status: 201 },
  )
}
