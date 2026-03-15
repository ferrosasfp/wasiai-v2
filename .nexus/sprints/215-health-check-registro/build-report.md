# Build Report — SDD #215

## Wave execution

| Wave | Status | Build | Detalle |
|------|--------|-------|---------|
| 1 — Migración DB | ✅ | ✅ clean | `057_agents_health_check.sql` creado con DROP legacy + ADD JSONB + nuevo índice |
| 2 — health-probe.ts | ✅ | ✅ clean | `probeEndpoint()` con SSRF check, AbortSignal.timeout(5s), fire-and-forget |
| 3 — GET /status route | ✅ | ✅ clean | x-agent-key auth, SHA256 lookup, ownership check, next_step condicional |
| 4 — register/route.ts | ✅ | ✅ clean | probeEndpoint fire-and-forget para non-JWT, health_check + status_url en respuesta |
| 5 — PATCH creator/[slug] | ✅ | ✅ clean | Re-probe automático al cambiar endpoint_url, status → reviewing |
| 6 — Commit | ✅ | — | 5 archivos, 210 inserciones |

## Commit
Hash: `3dff698`
Files changed: 5

## Discrepancias

- **Wave 4 — campo `message` duplicado:** El SDD indicaba agregar un campo `message` al objeto de respuesta, pero ya existía `message: 'Agent registered successfully'` en el mismo objeto. Se resolvió consolidando ambos en un solo campo condicional: si `authMethod !== 'jwt' && agent.endpoint_url`, retorna el mensaje de verificación; de lo contrario, retorna el mensaje de éxito original. El comportamiento final es equivalente al SDD.

## Notas
- `tsc --noEmit` pasa limpio en todas las waves
- No se modificó `src/app/api/v1/agents/[slug]/health/route.ts` (prohibido por SDD)
- No se hizo `git push` (solo commit local)
- probeEndpoint: nunca se awaita en handlers — siempre `.catch()` fire-and-forget
