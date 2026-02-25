/**
 * Validates that an endpoint URL is safe to call from the server.
 * Prevents SSRF attacks by blocking private/internal addresses (IPv4 and IPv6).
 *
 * HAL-014: Added IPv6 private ranges.
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

  // IPv4 private/internal patterns
  const blockedIPv4Patterns = [
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

  if (blockedIPv4Patterns.some(p => hostname.startsWith(p) || hostname === p.replace('.', ''))) {
    throw new Error('Private or internal endpoint URLs are not allowed')
  }

  // HAL-014: IPv6 private/internal patterns
  const blockedIPv6Patterns = [
    /^\[?::1\]?$/,               // loopback
    /^\[?fc[0-9a-f]{2}:/i,       // fc00::/7 Unique Local
    /^\[?fd[0-9a-f]{2}:/i,       // fd00::/8 Unique Local
    /^\[?fe80:/i,                 // fe80::/10 Link-Local
    /^\[?::ffff:/i,               // IPv4-mapped IPv6
    /^\[?0:0:0:0:0:ffff:/i,      // IPv4-mapped alternativo
    /^\[?64:ff9b:/i,              // NAT64
  ]

  for (const pattern of blockedIPv6Patterns) {
    if (pattern.test(hostname)) {
      throw new Error('Private or internal IPv6 endpoint URLs are not allowed')
    }
  }
}
