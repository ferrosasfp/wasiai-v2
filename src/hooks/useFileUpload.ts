'use client'

/**
 * useFileUpload.ts — Reusable file upload hook
 *
 * T-11: Extracts repeated upload logic from PublishForm and other components
 *       into a single, testable hook.
 *
 * Usage:
 *   const { upload, uploading, error, reset } = useFileUpload()
 *   await upload(file) // returns { url, cid } or undefined on error
 */
import { useState, useCallback } from 'react'

interface UploadResult {
  url: string
  cid: string
}

interface UseFileUploadReturn {
  upload: (file: File) => Promise<UploadResult | undefined>
  uploading: boolean
  error: string | null
  reset: () => void
}

export function useFileUpload(uploadEndpoint = '/api/storage/upload'): UseFileUploadReturn {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setError(null)
  }, [])

  const upload = useCallback(async (file: File): Promise<UploadResult | undefined> => {
    setUploading(true)
    setError(null)

    try {
      const fd = new FormData()
      fd.append('file', file)

      const res = await fetch(uploadEndpoint, { method: 'POST', body: fd })
      const data = await res.json() as { url?: string; cid?: string; error?: string }

      if (!res.ok) {
        throw new Error(data.error ?? `Upload failed with status ${res.status}`)
      }

      if (!data.url || !data.cid) {
        throw new Error('Invalid response from upload endpoint')
      }

      return { url: data.url, cid: data.cid }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      setError(message)
      return undefined
    } finally {
      setUploading(false)
    }
  }, [uploadEndpoint])

  return { upload, uploading, error, reset }
}
