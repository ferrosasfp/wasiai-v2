## Build Report v2 — WAS-215

### Fixes aplicados

| Fix | Status | Detalle |
|-----|--------|---------|
| F1 — health-probe.ts: condición de éxito | ✅ OK | `res.ok \|\| res.status < 500` → `res.ok` (AC2: solo 2xx cuenta como alive) |
| F2 — health-probe.ts: detección de timeout | ✅ OK | `latency_ms >= 4_900` → `err instanceof DOMException && err.name === 'TimeoutError'`; eliminada variable `latency_ms` del catch |
| F3 — register/route.ts: campo status en 201 | ✅ OK | Añadido `status: agent.endpoint_url ? 'reviewing' : 'draft'` en respuesta 201 usando spread condicional |
| F4 — creator/[slug]/route.ts: cooldown 60s | ✅ OK | Añadido `last_checked_at` al SELECT de `existing`; cooldown 60s antes de re-probe (anti DoS amplifier) |
| F5 — status/route.ts: IDOR fix | ✅ OK | Combinado `!agent \|\| keyRecord.owner_id !== agent.creator_id` en único 404, evitando revelar existencia de agentes |
| F6 — status/route.ts: rate limit | ✅ OK | Añadida función `getStatusCheckLimit()` en ratelimit.ts (60 req/min); aplicada en GET /status tras validar key |

### Build gate

Resultado: **OK** (0 errores TypeScript — `npx tsc --noEmit` sin output)

### Commit

Hash: `a443dd3`

### Issues encontrados durante implementación

- **Fix 6 — signature de checkRateLimit**: La función `checkRateLimit` toma `(limiter, identifier)` y retorna `NextResponse | null` (no un objeto con `.status`). Se adaptó el código para usar el retorno directo en lugar de verificar `.status === 429`.
- **Fix 6 — getStatusCheckLimit sin NextRequest**: El patrón de las otras funciones en ratelimit.ts no recibe `req` como parámetro (el limiter es compartido, el identifier se pasa al `checkRateLimit`). Se implementó `getStatusCheckLimit()` sin parámetro, consistente con el resto del archivo.
- **Fix 4 — select ambiguo**: El archivo tenía dos `.select('id, creator_id')` (PATCH y DELETE). Se editó solo el del PATCH usando contexto único del bloque.
