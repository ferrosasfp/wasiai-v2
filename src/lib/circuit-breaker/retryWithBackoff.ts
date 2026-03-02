export const RETRY_DELAYS_MS = [0, 500, 1500] as const

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isNetworkError(err: unknown): boolean {
  // fetch lanza TypeError para errores de red
  // AbortSignal.timeout() lanza DOMException con name='TimeoutError' o name='AbortError'
  if (err instanceof TypeError) return true
  if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) return true
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) return true
  return false
}

/**
 * Retry fn up to RETRY_DELAYS_MS.length times.
 * Only retries on network errors (TypeError / AbortError / TimeoutError).
 * Never retries on HTTP 4xx/5xx (those don't throw — they return a Response).
 * recordFailure is handled by wrapWithCircuitBreaker, not here.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
    if (i > 0) await sleep(RETRY_DELAYS_MS[i])
    try {
      return await fn()
    } catch (err) {
      if (!isNetworkError(err)) throw err // no reintentar: no es network error
      lastErr = err
    }
  }
  throw lastErr
}
