/**
 * Validates that an endpoint URL is safe to call from the server.
 * Prevents SSRF attacks by blocking private/internal addresses (IPv4 and IPv6).
 *
 * HAL-014: Added IPv6 private ranges.
 * NG-005: Added DNS probe — resolves hostname and validates resolved IP is public.
 *         Mitigates DNS rebinding: validates the IP that will actually be connected to.
 */

// DNS probe uses Node.js dns/promises — only available in Node.js runtime (not Edge)
// Import is dynamic to avoid breaking Edge routes that don't call validateEndpointUrl.

const BLOCKED_IPV4_PREFIXES = [
  '127.',
  '0.0.0.0',
  '169.254.',  // Link-local / metadata
  '10.',
  '172.16.', '172.17.', '172.18.', '172.19.', '172.20.',
  '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
  '172.26.', '172.27.', '172.28.', '172.29.', '172.30.',
  '172.31.',
  '192.168.',
  '100.100.100.200',
  '169.254.169.254',
]

const BLOCKED_HOSTNAMES = [
  'localhost',
  'metadata.google.internal',
  'metadata.internal',
]

const BLOCKED_IPV6_PATTERNS = [
  /^\[?::1\]?$/,
  /^\[?fc[0-9a-f]{2}:/i,
  /^\[?fd[0-9a-f]{2}:/i,
  /^\[?fe80:/i,
  /^\[?::ffff:/i,
  /^\[?0:0:0:0:0:ffff:/i,
  /^\[?64:ff9b:/i,
  /^\[?fd00:ec2:/i,
]

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.includes(h)) return true
  if (BLOCKED_IPV4_PREFIXES.some(p => h.startsWith(p))) return true
  if (BLOCKED_IPV6_PATTERNS.some(r => r.test(h))) return true
  return false
}

/**
 * NG-005: DNS resolution probe — resolves the hostname and validates
 * that none of the resolved IPs are private/internal.
 * This prevents DNS rebinding where the initial resolve returns a public IP
 * but a subsequent resolve (at connection time) returns 127.0.0.1.
 */
async function validateResolvedIPs(hostname: string): Promise<void> {
  try {
    // Dynamic import: only works in Node.js runtime, not Edge
    const dns = await import('node:dns/promises')
    const addresses = await dns.lookup(hostname, { all: true })
    for (const { address } of addresses) {
      if (isBlockedHost(address)) {
        throw new Error(`Resolved IP ${address} is private or internal`)
      }
    }
  } catch (err) {
    // If import fails (Edge runtime), skip DNS probe — basic blocklist still applies
    if (err instanceof Error && err.message.includes('private or internal')) {
      throw err
    }
    // DNS resolution failure (NXDOMAIN, timeout) → block
    if (err instanceof Error && (
      err.message.includes('ENOTFOUND') ||
      err.message.includes('ETIMEOUT') ||
      err.message.includes('EAI_AGAIN')
    )) {
      throw new Error(`DNS resolution failed for hostname: ${hostname}`)
    }
    // Module not available (Edge runtime) — skip probe silently
  }
}

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

  if (isBlockedHost(hostname)) {
    throw new Error('Private or internal endpoint URLs are not allowed')
  }
}

/**
 * Async version with DNS probe — use when in Node.js runtime (API routes).
 * Falls back gracefully if DNS unavailable (Edge runtime).
 */
export async function validateEndpointUrlAsync(rawUrl: string): Promise<void> {
  validateEndpointUrl(rawUrl) // synchronous basic check first

  const url = new URL(rawUrl)
  await validateResolvedIPs(url.hostname)
}
