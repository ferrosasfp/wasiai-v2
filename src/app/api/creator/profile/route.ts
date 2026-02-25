/**
 * PATCH /api/creator/profile
 *
 * Updates creator profile fields used during onboarding:
 * display_name, bio, onboarding_step
 *
 * Auth: required (session cookie)
 * Rate limit: 10 requests/minute per user via Upstash Redis
 */
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, getIdentifier } from '@/lib/ratelimit'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// 10 req/min per user — separate limiter for profile PATCH
let _profileLimit: Ratelimit | null = null
function getProfileLimit(): Ratelimit {
  return (_profileLimit ??= new Ratelimit({
    redis: new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    }),
    limiter: Ratelimit.slidingWindow(10, '1 m'),
    prefix: 'rl:profile',
  }))
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Rate limit: 10 req/min per user
  const identifier = getIdentifier(req, user.id)
  const rateLimitResponse = await checkRateLimit(getProfileLimit(), identifier)
  if (rateLimitResponse) return rateLimitResponse

  const body = await req.json().catch(() => ({}))
  const { display_name, bio, onboarding_step } = body as {
    display_name?: string
    bio?: string
    onboarding_step?: number
  }

  // Validate fields
  if (display_name !== undefined && (typeof display_name !== 'string' || display_name.trim().length === 0)) {
    return NextResponse.json({ error: 'display_name no puede estar vacío' }, { status: 400 })
  }
  if (bio !== undefined && (typeof bio !== 'string' || bio.length > 160)) {
    return NextResponse.json({ error: 'bio tiene máximo 160 caracteres' }, { status: 400 })
  }
  if (onboarding_step !== undefined && (typeof onboarding_step !== 'number' || onboarding_step < 1 || onboarding_step > 3)) {
    return NextResponse.json({ error: 'onboarding_step debe ser 1, 2 o 3' }, { status: 400 })
  }

  // Build update payload — only include provided fields
  const updates: Record<string, string | number> = {}
  if (display_name !== undefined) updates.display_name = display_name.trim()
  if (bio !== undefined)          updates.bio          = bio.trim()
  if (onboarding_step !== undefined) updates.onboarding_step = onboarding_step

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Sin campos para actualizar' }, { status: 400 })
  }

  const { error } = await supabase
    .from('creator_profiles')
    .update(updates)
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
