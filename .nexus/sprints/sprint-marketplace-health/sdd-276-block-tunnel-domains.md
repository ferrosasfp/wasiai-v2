# SDD WAS-276 — Bloquear dominios de desarrollo en endpoint_url
**Clasificación:** HU-MINOR
**Archivo único:** `src/lib/security/validateEndpointUrl.ts`

## Context
`validateEndpointUrl` bloquea IPs privadas y localhost pero no dominios de tunnel conocidos.
Un agente fue publicado en prod con `https://agentlinkedin-api.loca.lt/...` (localtunnel). La función es llamada en:
- `src/app/api/v1/agents/register/route.ts` (registro)
- `src/app/api/v1/models/[slug]/invoke/route.ts` (callUpstream)
- `src/app/api/creator/agents/[slug]/status/route.ts` NO la llama actualmente → el update de endpoint_url pasa por `src/app/api/creator/agents/[slug]/route.ts` (PATCH general del agente — verificar en Wave 0)

Agregar la lista a `validateEndpointUrl.ts` propaga el bloqueo a todos los call sites automáticamente.

## Acceptance Criteria
- AC1: WHEN endpoint_url contiene dominio de tunnel conocido THEN `validateEndpointUrl` lanza error con mensaje "Tunnel/development domains are not allowed as agent endpoints"
- AC2: WHEN el dominio está en mayúsculas o mixto THEN el bloqueo aplica igual (case-insensitive)
- AC3: WHEN el dominio tiene puerto no estándar (`host.loca.lt:4000`) THEN el bloqueo aplica igual
- AC4: WHEN el dominio es legítimo de producción THEN la validación pasa sin cambio
- AC5: WHEN se llama `validateEndpointUrlAsync` THEN hereda el bloqueo (ya que llama `validateEndpointUrl` internamente)

## Dominios a bloquear
```
*.loca.lt
*.ngrok.io
*.ngrok-free.app
*.trycloudflare.com
*.serveo.net
*.localhost.run
*.pagekite.me
*.bore.pub
```

## Wave 0 — Pre-flight
- [ ] Leer `src/lib/security/validateEndpointUrl.ts` completo
- [ ] Verificar qué rutas llaman `validateEndpointUrl` o `validateEndpointUrlAsync`: `grep -r "validateEndpoint" src/ --include="*.ts" -l`
- [ ] Verificar si existe ruta PATCH para actualización de endpoint_url: `grep -r "endpoint_url" src/app/api/creator --include="*.ts" -l`
- [ ] Build gate: `npx tsc --noEmit`

## Wave 1 — Agregar BLOCKED_TUNNEL_DOMAINS
**Archivo:** `src/lib/security/validateEndpointUrl.ts`

Agregar después de `BLOCKED_HOSTNAMES`:
```typescript
// WAS-276: Block development tunnel domains — these are temporary and not suitable for production
const BLOCKED_TUNNEL_SUFFIXES = [
  '.loca.lt',
  '.ngrok.io',
  '.ngrok-free.app',
  '.trycloudflare.com',
  '.serveo.net',
  '.localhost.run',
  '.pagekite.me',
  '.bore.pub',
]
```

Modificar `isBlockedHost` para incluir el check (después de los checks existentes):
```typescript
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.includes(h)) return true
  if (BLOCKED_IPV4_PREFIXES.some(p => h.startsWith(p))) return true
  if (BLOCKED_IPV6_PATTERNS.some(r => r.test(h))) return true
  // WAS-276: Block tunnel/development domains
  if (BLOCKED_TUNNEL_SUFFIXES.some(suffix => h === suffix.slice(1) || h.endsWith(suffix))) return true
  return false
}
```

Actualizar el mensaje de error en `validateEndpointUrl`:
```typescript
if (isBlockedHost(hostname)) {
  throw new Error('Private, internal, or tunnel/development endpoint URLs are not allowed')
}
```

**Build gate:** `npx tsc --noEmit`

## Wave 2 — Verificar cobertura en ruta de update de endpoint
Si existe `src/app/api/creator/agents/[slug]/route.ts` con PATCH que actualiza `endpoint_url`:
- Verificar que llama `validateEndpointUrlAsync` al cambiar `endpoint_url`
- Si no lo hace: agregar la llamada antes del update en DB
- Si no existe esa ruta o el update de endpoint pasa solo por registro: documentar como out-of-scope en comentario

**Build gate:** `npx tsc --noEmit`

## Rollback
`git revert HEAD` — solo `validateEndpointUrl.ts` modificado, sin migraciones.

## Critical Constraints
- PROHIBIDO eliminar o modificar los checks existentes de IPv4/IPv6/localhost
- OBLIGATORIO que el check sea case-insensitive (usar `.toLowerCase()` ya existente)
- PROHIBIDO hacer fetch o DNS probe en el check de tunnels — es solo string matching
