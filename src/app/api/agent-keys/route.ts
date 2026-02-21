import { NextRequest, NextResponse } from 'next/server'
import { createAgentKey, getAgentKeys, revokeAgentKey } from '@/features/agent-api/services/agent-keys.service'
import { z } from 'zod'

const createSchema = z.object({
  name: z.string().min(1).max(64),
  budget_usdc: z.number().min(1).max(1000).default(10),
})

export async function GET() {
  try {
    const keys = await getAgentKeys()
    // Never expose raw keys
    return NextResponse.json(keys.map(k => ({ ...k, key_hash: undefined })))
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, budget_usdc } = createSchema.parse(body)
    const key = await createAgentKey(name, budget_usdc)
    // Return raw key ONCE — never retrievable again
    return NextResponse.json({
      ...key,
      key_hash: undefined,
      message: 'Save this key — it will not be shown again',
    }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json()
    await revokeAgentKey(id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Error' }, { status: 400 })
  }
}
