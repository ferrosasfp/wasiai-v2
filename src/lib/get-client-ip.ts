/**
 * Extrae el IP más confiable del request.
 * Prioridad: cf-connecting-ip > x-real-ip > x-forwarded-for[0] > fallback
 * Node runtime only — do not use in Edge routes.
 */
export function getClientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    '127.0.0.1'
  )
}
