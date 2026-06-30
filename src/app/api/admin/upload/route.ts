/**
 * POST /api/admin/upload — upload image to Supabase Storage
 * Auth: requires EIP-712 admin signature (same gate as /api/admin/collections).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyAdminSignature, type AdminActionMessage } from '@/lib/admin/verifyAdminSignature'
import { jsonError } from '@/lib/api/jsonError'

// V-09 (audit 2026-06-25): only these buckets may be written. The bucket name
// arrived from untrusted formData and was passed straight to Supabase Storage,
// letting any caller write to an arbitrary bucket.
const ALLOWED_BUCKETS = new Set(['collections', 'agents', 'avatars'])

// V-09: EIP-712 admin gate (was: any authenticated user). Mirrors fee/settlement.
async function verifyAuth(request: NextRequest, action: string) {
  const sig      = request.headers.get('x-admin-signature') as `0x${string}` | null
  const nonceHdr = request.headers.get('x-admin-nonce')     as `0x${string}` | null
  const tsHdr    = request.headers.get('x-admin-timestamp')

  if (!sig || !nonceHdr || !tsHdr) return { ok: false, status: 401, reason: 'Missing admin auth headers' }

  const message: AdminActionMessage = { action, nonce: nonceHdr, timestamp: BigInt(tsHdr) }
  const { ok, reason } = await verifyAdminSignature(sig, message)
  return ok ? { ok: true } : { ok: false, status: 401, reason }
}

export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request, 'adminUpload')
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status ?? 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const bucket = (formData.get('bucket') as string) || 'collections'

  // V-09: reject arbitrary buckets.
  if (!ALLOWED_BUCKETS.has(bucket)) {
    return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 })
  }

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  // Validate type
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  if (!allowed.includes(file.type)) {
    return NextResponse.json({ error: 'Invalid file type. Allowed: png, jpg, webp, gif' }, { status: 400 })
  }

  // 2MB limit
  if (file.size > 2 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large. Max 2MB' }, { status: 400 })
  }

  const ext = file.name.split('.').pop() ?? 'png'
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const supabase = createServiceClient()
  const { error } = await supabase.storage
    .from(bucket)
    .upload(fileName, file, { contentType: file.type, upsert: false })

  if (error) {
    return jsonError('upload_failed', 'Failed to upload file', 500, { logDetail: error })
  }

  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(fileName)

  return NextResponse.json({ url: urlData.publicUrl })
}
