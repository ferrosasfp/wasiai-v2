import type { HttpClient } from './client'
import type { InvokeResult } from './types'
import { assertSlug } from './utils'

export async function invokeAgent(
  http: HttpClient,
  slug: string,
  input: Record<string, unknown>,
): Promise<InvokeResult> {
  assertSlug(slug)
  return http.request<InvokeResult>(
    'POST',
    `/api/v1/agents/${slug}/invoke`,
    input,
    true,
  )
}
