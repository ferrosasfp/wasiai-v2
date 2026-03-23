# Build Report — SDD WAS-276

## Wave execution

| Wave | Status | Build | Detalle |
|------|--------|-------|---------|
| Wave 0 | ✅ PASS | ✅ PASS | Pre-flight OK. `validateEndpointUrl.ts` existe, no tiene tunnel check. PATCH route existe sin `validateEndpointUrlAsync`. |
| Wave 1 | ✅ DONE | ✅ PASS | `src/lib/security/validateEndpointUrl.ts` — Added `BLOCKED_TUNNEL_SUFFIXES`, updated `isBlockedHost`, updated error message. |
| Wave 2 | ✅ DONE | ✅ PASS | `src/app/api/creator/agents/[slug]/route.ts` — Added `validateEndpointUrlAsync` call before DB update when `endpoint_url` changes. |

## Commit
- Hash: `fb3140678`
- Message: `fix(security): WAS-276 — block tunnel/dev domains in validateEndpointUrl`
- Files changed: 2

## Discrepancias encontradas
- Ninguna. El SDD era preciso y compatible con el código real.

## Notas
- Wave 2: La ruta PATCH actualizaba `endpoint_url` en DB sin validación previa. Se agregó `validateEndpointUrlAsync` antes del update, retornando 422 si el dominio es tunnel/dev.
- El check es case-insensitive via `.toLowerCase()` ya existente en `isBlockedHost`.
- No se modificaron los checks existentes de IPv4/IPv6/localhost.
