/**
 * POST /api/storage/upload
 *
 * Uploads an image to Pinata IPFS and returns the public URL.
 * Requires authenticated user.
 * Accepts multipart/form-data with a `file` field.
 *
 * Max size: 5MB
 * Allowed types: image/jpeg, image/png, image/webp, image/gif
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUploadLimit, checkRateLimit } from '@/lib/ratelimit'

const MAX_SIZE   = 5 * 1024 * 1024  // 5MB
const ALLOWED    = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const PINATA_JWT = process.env.PINATA_JWT ?? ''
const GATEWAY    = process.env.NEXT_PUBLIC_STORAGE_GATEWAY ?? 'https://gateway.pinata.cloud/ipfs'

export async function POST(request: NextRequest) {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Rate limiting — per user
  const rlHit = await checkRateLimit(getUploadLimit(), `user:${user.id}`)
  if (rlHit) return rlHit

  if (!PINATA_JWT) {
    return NextResponse.json({ error: 'Storage not configured' }, { status: 503 })
  }

  // Parse multipart form
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  // Validate type and size
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: `File type not allowed. Use: ${ALLOWED.join(', ')}` }, { status: 422 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large. Max 5MB.' }, { status: 422 })
  }

  // Upload to Pinata
  const body = new FormData()
  body.append('file', file)
  body.append('pinataMetadata', JSON.stringify({
    name: `wasiai-agent-cover-${user.id}-${Date.now()}`,
    keyvalues: { uploader: user.id, type: 'agent-cover' },
  }))

  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return NextResponse.json(
      { error: 'Upload failed', detail: (err as Record<string, string>).error ?? res.statusText },
      { status: 502 },
    )
  }

  const { IpfsHash } = await res.json() as { IpfsHash: string }

  return NextResponse.json({
    cid: IpfsHash,
    url: `${GATEWAY}/${IpfsHash}`,
  }, { status: 201 })
}
