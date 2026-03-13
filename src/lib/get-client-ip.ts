/**
 * Extrae el IP más confiable del request.
 * Prioridad: cf-connecting-ip > x-real-ip > x-forwarded-for[0] > fallback
 * Node runtime only — do not use in Edge routes.
 *
 * SECURITY: cf-connecting-ip is set by Cloudflare and cannot be spoofed when
 * traffic routes through CF. x-real-ip and x-forwarded-for are accepted as
 * fallback but are attacker-controlled if the server is exposed directly.
 */

const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]+$/i

function sanitizeIp(ip: string | null): string | null {
  if (!ip) return null
  const trimmed = ip.split(',')[0]?.trim() ?? ''
  return IP_REGEX.test(trimmed) ? trimmed : null
}

export function getClientIp(req: Request): string {
  return (
    sanitizeIp(req.headers.get('cf-connecting-ip')) ??
    sanitizeIp(req.headers.get('x-real-ip')) ??
    sanitizeIp(req.headers.get('x-forwarded-for')) ??
    '127.0.0.1'
  )
}
