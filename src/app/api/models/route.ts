import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const createModelSchema = z.object({
  name: z.string().min(3),
  slug: z.string().min(3).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  category: z.enum(['nlp', 'vision', 'audio', 'code', 'multimodal', 'data']),
  price_per_call: z.number().min(0.01).max(100),
  endpoint_url: z.string().url(),
  capabilities: z.array(z.object({
    name: z.string(),
    description: z.string(),
    inputType: z.string(),
    outputType: z.string(),
  })).optional().default([]),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const result = createModelSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: result.error.issues },
      { status: 422 },
    )
  }

  const { data, error } = await supabase
    .from('models')
    .insert({ ...result.data, creator_id: user.id })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Slug already taken' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
