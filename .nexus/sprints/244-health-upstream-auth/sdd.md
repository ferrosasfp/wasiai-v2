# SDD — WAS-244: Health check debe autenticar upstream con webhook_secret

## Context

`GET /api/v1/agents/[slug]/health` verifica si un agente upstream está disponible. Desde WAS-079, wasiai-agents requiere `Authorization: Bearer {webhook_secret}` en todos los requests POST. El probe actual no incluye auth → recibe 401 → lógica `probe.ok || probe.status < 500` lo marca como "healthy".

## Acceptance Criteria
- AC-01: Probe incluye `Authorization: Bearer {webhook_secret}` (si webhook_secret no es null)
- AC-02: HTTP 200 upstream → status: "healthy"
- AC-03: HTTP 4xx/5xx upstream (incluyendo 401) → status: "unhealthy"
- AC-04: webhook_secret null/empty → probe sin auth header (graceful)
- AC-05: webhook_secret NO aparece en API response
- AC-06: Shape del response se preserva

## Wave 0 — Pre-flight

- [ ] Leer `src/app/api/v1/agents/[slug]/health/route.ts` (ya leído por SM)
- [ ] Confirmar que `agents` table tiene columna `webhook_secret` (de WAS-078)
- [ ] Confirmar que `webhook_secret` no se expone en ningún select público

## Wave 1 — Fix health/route.ts

**Archivo:** `src/app/api/v1/agents/[slug]/health/route.ts`

### Cambio 1: select + webhook_secret (no expuesto)
```diff
- .select('slug, name, status, endpoint_url')
+ .select('slug, name, status, endpoint_url, webhook_secret')
```

### Cambio 2: probe con auth header
```diff
  const probe = await fetch(model.endpoint_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
+     ...(model.webhook_secret ? { 'Authorization': `Bearer ${model.webhook_secret}` } : {}),
    },
    body: JSON.stringify({ ping: true }),
    signal: AbortSignal.timeout(5_000),
  })
```

### Cambio 3: lógica de status — 4xx es unhealthy
```diff
- status: probe.ok || probe.status < 500 ? 'healthy' : 'unhealthy',
+ status: probe.ok ? 'healthy' : 'unhealthy',
```

### Cambio 4: NO incluir webhook_secret en response
El objeto de response NO debe incluir `webhook_secret`. Destructurar explícitamente:
```typescript
const { webhook_secret: _wh, ...publicModel } = model  // eslint-disable-line @typescript-eslint/no-unused-vars
```
O simplemente no referenciar `webhook_secret` fuera del probe headers.

**Build gate:** `npm run typecheck && npm run lint`

## Rollback

`git revert <commit>` — 1 archivo, sin migración DB.

## Constraint Directives

- OBLIGATORIO: Enviar webhook_secret en probe si no es null
- OBLIGATORIO: probe.ok (solo 2xx) = healthy
- PROHIBIDO: webhook_secret en response body
- PROHIBIDO: tocar otros archivos fuera de health/route.ts

## Commit format

```
fix(WAS-244): health probe sends webhook_secret auth — treat 4xx as unhealthy
```
