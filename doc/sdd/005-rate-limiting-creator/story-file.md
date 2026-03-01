# Story File #005 — HU-8.4: Rate Limiting configurable por creator

> Dev: leer SOLO este archivo. No consultar SDD ni Work Item.
> Si algo es ambiguo → PARAR y preguntar a Architect.

## Goal
Permitir que cada creator defina cuántas veces por minuto (max_rpm) y por día (max_rpd)
puede un consumer invocar su agente. El middleware de invocación aplica estos límites
usando Upstash Redis (ya configurado). Sin configuración → defaults (60 rpm, 1000 rpd).

## Acceptance Criteria
| # | AC |
|---|---|
| 1 | WHEN creator publica/edita agente, THE creator SHALL poder configurar max_rpm y max_rpd |
| 2 | WHEN consumer supera max_rpm, THE API SHALL responder 429 con header Retry-After en segundos |
| 3 | WHEN consumer supera max_rpd, THE API SHALL responder 429 con body `{error: "Daily limit reached"}` |
| 4 | WHEN rate limit no configurado, THE agente SHALL usar defaults (60 rpm, 1000 rpd) |
| 5 | WHILE consumer está dentro de límites, THE invocación SHALL proceder normalmente |

## Integration Contract
- **Migration 025** agrega `max_rpm INT DEFAULT 60` y `max_rpd INT DEFAULT 1000` a tabla `agents`
- **PublishForm** lee esos campos del draft y los envía en el POST/PATCH a `/api/models`
- **invoke route** (`/api/v1/models/[slug]/invoke`) lee `max_rpm`/`max_rpd` del agente en DB y aplica el límite via Upstash antes de procesar el pago

## Files to Modify/Create

| Archivo | Acción | Exemplar |
|---------|--------|---------|
| `supabase/migrations/025_rate_limits.sql` | CREATE | `supabase/migrations/024_defi_risk_agents.sql` |
| `src/lib/ratelimit.ts` | MODIFY — agregar `getCreatorLimit()` | mismo archivo |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | MODIFY — agregar check rate limit creator | mismo archivo |
| `src/features/publish/PublishForm.tsx` | MODIFY — agregar campos max_rpm/max_rpd | mismo archivo |
| `src/lib/schemas/model.schema.ts` | MODIFY — agregar max_rpm/max_rpd al schema | mismo archivo |

## Waves

### W0 — Migration + Schema (serial)
1. Crear `supabase/migrations/025_rate_limits.sql`:
```sql
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS max_rpm  INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS max_rpd  INTEGER NOT NULL DEFAULT 1000;
```
2. Aplicar: `supabase db push` (o via Management API)
3. Agregar `max_rpm` y `max_rpd` al `createModelSchema` en `model.schema.ts`:
```ts
max_rpm: z.number().int().min(1).max(600).optional().default(60),
max_rpd: z.number().int().min(1).max(100000).optional().default(1000),
```

### W1 — Ratelimit helper + invoke middleware (paralelizable tras W0)

**W1.A — `src/lib/ratelimit.ts`**
Agregar función `getCreatorRateLimit` que crea un limiter dinámico por slug+api_key:
```ts
// Creator-configurable rate limit — rpm por agente por API key
export function getCreatorRpmLimit(slug: string, maxRpm: number): Ratelimit {
  return new Ratelimit({
    redis: makeRedis(),
    limiter: Ratelimit.slidingWindow(maxRpm, '1 m'),
    prefix: `rl:creator:${slug}:rpm`,
  })
}

export function getCreatorRpdLimit(slug: string, maxRpd: number): Ratelimit {
  return new Ratelimit({
    redis: makeRedis(),
    limiter: Ratelimit.slidingWindow(maxRpd, '1 d'),
    prefix: `rl:creator:${slug}:rpd`,
  })
}
```

**W1.B — invoke route** (`src/app/api/v1/models/[slug]/invoke/route.ts`)
Después de cargar el agente de DB (ya existe ese fetch), y ANTES del pago x402:
```ts
// HU-8.4: Creator-configurable rate limiting
const apiKeyId = request.headers.get('x-agent-key')?.substring(0, 24) ?? 'anon'
const identifier = `${slug}:${apiKeyId}`

// Check RPM
const rpmLimiter = getCreatorRpmLimit(slug, agent.max_rpm ?? 60)
const rpmResult = await rpmLimiter.limit(identifier)
if (!rpmResult.success) {
  return NextResponse.json(
    { error: 'Rate limit exceeded', code: 'rate_limited' },
    { status: 429, headers: {
      'Retry-After': String(Math.ceil((rpmResult.reset - Date.now()) / 1000)),
      'X-RateLimit-Limit': String(rpmResult.limit),
    }}
  )
}

// Check RPD
const rpdLimiter = getCreatorRpdLimit(slug, agent.max_rpd ?? 1000)
const rpdResult = await rpdLimiter.limit(identifier)
if (!rpdResult.success) {
  return NextResponse.json(
    { error: 'Daily limit reached', code: 'daily_limit_reached' },
    { status: 429, headers: { 'Retry-After': String(Math.ceil((rpdResult.reset - Date.now()) / 1000)) } }
  )
}
```

### W2 — PublishForm UI (tras W0)
En `PublishForm.tsx`, dentro del paso de configuración de precio/endpoint (paso 2 o 3):
- Agregar sección colapsable "Rate Limits" con dos campos numéricos: max_rpm y max_rpd
- Seguir el patrón de los inputs existentes en el formulario (className, label, helpText)
- Incluir texto de ayuda: "Requests por minuto por usuario" / "Requests por día por usuario"
- Valores default: 60 / 1000
- Min/Max: rpm 1-600, rpd 1-100000

## Constraint Directives

### OBLIGATORIO
- Seguir el patrón de `getInvokeLimit()` en `ratelimit.ts` para los nuevos limiters
- Usar `slidingWindow` (no `fixedWindow`) — consistente con el resto del proyecto
- El identifier siempre es `slug:api_key_prefix` — nunca solo el slug (aisla por consumer)
- El check de rate limit debe ocurrir ANTES del cargo x402

### PROHIBIDO
- NO crear un nuevo cliente Redis — reutilizar `makeRedis()`
- NO cachear los limiters en singletons (son dinámicos por agente)
- NO modificar la lógica de pago x402
- NO tocar otros endpoints fuera de `/api/v1/models/[slug]/invoke`
- NO agregar dependencias nuevas — Upstash ya está instalado

## Out of Scope
- Dashboard de métricas de rate limit
- Rate limiting en `/api/v1/compose`
- Notificaciones al consumer cuando se acerca al límite
- Rate limiting por IP (ya existe globalmente)

## Escalation Rule
Si algo no está en este Story File → PARAR y preguntar a Architect. No improvisar.
