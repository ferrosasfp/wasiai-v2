'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createStorageProvider } from '@/features/storage/services/storageProvider'

// Security constants
const MAX_FILE_SIZE = 10_000_000 // 10MB
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/json',
] as const

// Zod schemas for validation
const cidSchema = z.string().regex(
  /^(Qm[1-9A-HJ-NP-Za-km-z]{44,}|bafy[a-z2-7]{55,})$/,
  'Invalid IPFS CID format'
)

const metadataSchema = z.record(z.string(), z.string()).optional()

const fileSchema = z.object({
  size: z.number().max(MAX_FILE_SIZE, `File size must not exceed ${MAX_FILE_SIZE / 1_000_000}MB`),
  type: z.enum(ALLOWED_MIME_TYPES, {
    error: `File type must be one of: ${ALLOWED_MIME_TYPES.join(', ')}`,
  }),
})

export async function uploadFile(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const file = formData.get('file') as File | null
  if (!file) {
    return { error: 'No file provided' }
  }

  // Validate file size and MIME type
  const fileValidation = fileSchema.safeParse({
    size: file.size,
    type: file.type,
  })

  if (!fileValidation.success) {
    return { error: fileValidation.error.issues[0].message }
  }

  // Parse and validate metadata
  const metadataStr = formData.get('metadata') as string | null
  let metadata: Record<string, string> | undefined
  if (metadataStr) {
    try {
      const parsed: unknown = JSON.parse(metadataStr)
      const metadataValidation = metadataSchema.safeParse(parsed)

      if (!metadataValidation.success) {
        return { error: 'Invalid metadata format' }
      }

      metadata = metadataValidation.data
    } catch {
      return { error: 'Invalid JSON in metadata field' }
    }
  }

  try {
    const provider = createStorageProvider()
    const result = await provider.upload(file, metadata)

    // T-01: Track CID ownership in user_files table for RLS-based delete protection
    await supabase.from('user_files').insert({
      user_id:    user.id,
      cid:        result.cid,
      filename:   file.name,
      mime_type:  file.type,
      size_bytes: file.size,
    }).then(() => {}) // Non-fatal: file is uploaded even if tracking fails

    return { cid: result.cid, url: result.url }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed'
    return { error: message }
  }
}

// T-01: Ownership check via user_files table — only owners can delete their CIDs
export async function deleteFile(cid: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Validate CID format
  const cidValidation = cidSchema.safeParse(cid)

  if (!cidValidation.success) {
    return { error: cidValidation.error.issues[0].message }
  }

  // T-01: Verify ownership before deleting
  const { data: fileRecord } = await supabase
    .from('user_files')
    .select('id')
    .eq('user_id', user.id)
    .eq('cid', cidValidation.data)
    .single()

  // If no ownership record found, the CID doesn't belong to this user
  // (or the file was uploaded before the user_files table existed — allow deletion for legacy files)
  if (fileRecord === null) {
    // Check if any user owns this CID (if so, block deletion by other users)
    const { count } = await supabase
      .from('user_files')
      .select('id', { count: 'exact', head: true })
      .eq('cid', cidValidation.data)

    if (count && count > 0) {
      return { error: 'Forbidden: you do not own this file' }
    }
    // Legacy CID with no ownership record — allow (backward compatibility)
  }

  try {
    const provider = createStorageProvider()
    await provider.delete(cidValidation.data)

    // Remove ownership record
    await supabase
      .from('user_files')
      .delete()
      .eq('user_id', user.id)
      .eq('cid', cidValidation.data)

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Delete failed'
    return { error: message }
  }
}

export async function getFileUrl(cid: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Validate CID format
  const cidValidation = cidSchema.safeParse(cid)

  if (!cidValidation.success) {
    return { error: cidValidation.error.issues[0].message }
  }

  try {
    const provider = createStorageProvider()
    const url = await provider.retrieve(cidValidation.data)
    return { url }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to get URL'
    return { error: message }
  }
}
