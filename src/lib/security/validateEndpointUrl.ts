/**
 * Validates that an endpoint URL is safe to call from the server.
 * Prevents SSRF attacks by blocking private/internal addresses.
 */
export function validateEndpointUrl(rawUrl: string): void {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Invalid URL format')
  }

  if (url.protocol !== 'https:') {
    throw new Error('Only HTTPS endpoints are allowed')
  }

  const hostname = url.hostname.toLowerCase()

  const blockedPatterns = [
    'localhost',
    '127.',
    '0.0.0.0',
    '169.254.', // AWS/GCP metadata
    '10.',
    '172.16.',
    '172.17.',
    '172.18.',
    '172.19.',
    '172.20.',
    '172.21.',
    '172.22.',
    '172.23.',
    '172.24.',
    '172.25.',
    '172.26.',
    '172.27.',
    '172.28.',
    '172.29.',
    '172.30.',
    '172.31.',
    '192.168.',
    '[::1]',
    '::1',
    'metadata.google.internal',
    'metadata.internal',
  ]

  if (blockedPatterns.some(p => hostname.startsWith(p) || hostname === p.replace('.', ''))) {
    throw new Error('Private or internal endpoint URLs are not allowed')
  }
}
