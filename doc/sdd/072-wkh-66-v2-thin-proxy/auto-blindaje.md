# Auto-Blindaje — WKH-66 — v2 thin-proxy refactor

### [2026-04-28 21:25] Wave 3 — RequestInit DOM vs Next type mismatch
- **Error**: `TS2345 Argument of type 'RequestInit & { duplex: "half" }' is not assignable to NextRequest constructor parameter — signal: AbortSignal | null vs AbortSignal | undefined`.
- **Causa raíz**: Next 16 expone su propio `RequestInit` cuyo `signal` excluye `null`. El lib.dom global usa `AbortSignal | null`. Cuando se construye un `NextRequest` con un init basado en `req.headers` y casteado al `RequestInit` del DOM, el constructor rechaza el cast.
- **Fix**: Usar `ConstructorParameters<typeof NextRequest>[1]` como tipo de destino del cast vía `unknown`, asegurando alineación con la firma exacta del constructor de Next. Mantener la propiedad `duplex: 'half'` (requerida por undici cuando `body` es presente).
- **Aplicar en**: cualquier futuro proxy/route que reconstruya un `NextRequest` con body — usar el mismo patrón `as unknown as ConstructorParameters<typeof NextRequest>[1]`.

### [2026-04-28 21:28] Wave 3 — Tests trial.test.ts baseline failures
- **Error**: 6 tests en `src/app/api/v1/agents/__tests__/trial.test.ts` fallan con assertion `expected 400 to be 200/502/504`.
- **Causa raíz**: pre-existente en `main` antes de WKH-66. Baseline confirmado vía `git stash` + run de la suite contra el código original.
- **Fix**: NO aplica a WKH-66 (Scope OUT — `src/app/api/v1/agents/`). Documentar como baseline y dejar para una HU separada de mantenimiento del trial endpoint.
- **Aplicar en**: cualquier HU que toque `/api/v1/agents/[slug]/trial` debería arreglar estos tests primero.

### [2026-04-28 23:10] TD-002 — `/api/v1/capabilities` retorna 0 agents (loop infinito de delegación)

#### Sintoma
Smoke E2E contra `https://app.wasiai.io/api/v1/capabilities?limit=20` retorna
`{"agents":[],"total":0,"registries":["WasiAI"]}` cuando debería listar 22 agents
(verificable contra `/api/v1/agents` legacy). `/compose` y `/orchestrate`
funcionan correctamente.

#### Causa raiz
1. v2 `/api/v1/capabilities` — con `V2_DELEGATE_TO_A2A=...,capabilities` delega a
   `wasiai-a2a/discover`.
2. wasiai-a2a `/discover` consulta su `WasiAI` registry.
3. La `discoveryEndpoint` de ese registry apunta a
   `https://app.wasiai.io/api/v1/capabilities` (el mismo endpoint delegado).
4. Resultado: v2 → a2a → v2 → a2a → ... ningún hop accede a Supabase `agents`,
   `agents[]` nunca se popula → `total: 0`.

#### Repro steps
```bash
# Direct a2a Railway
curl "https://wasiai-a2a-production.up.railway.app/discover?limit=5"
# → {"agents":[],"total":0,"registries":["WasiAI"]}

# v2 thin-proxy hop
curl "https://app.wasiai.io/api/v1/capabilities?limit=20"
# → {"agents":[],"total":0,"registries":["WasiAI"]}

# Legacy v2 endpoint (no delegado, lee Supabase directo)
curl "https://app.wasiai.io/api/v1/agents?limit=3"
# → 22 agents reales

# Inspect a2a registry config
curl "https://wasiai-a2a-production.up.railway.app/registries"
# → discoveryEndpoint = "https://app.wasiai.io/api/v1/capabilities"  ← circular
```

#### Fix aplicado (v2 lado)
Loop-detection en `src/app/api/v1/capabilities/route.ts`:

  - Si la request lleva `x-agent-key` (header de auth que a2a usa hacia
    registries) y NO lleva `x-wasiai-source: v2-proxy` (que sólo el proxy
    frontal de v2 estampa), forzamos `legacyCapabilities()` y retornamos
    desde Supabase directo. Esto rompe el ciclo en el segundo hop sin
    afectar al primero.
  - Adicional: param mapping `tag→capabilities`, `max_price→maxPrice`,
    `min_reputation→minReputation` antes del forward, para que filtros
    server-side de a2a apliquen (defense-in-depth, no-op cuando no hay params).

#### Tests añadidos
`src/app/api/v1/capabilities/__tests__/td-002-proxy-loop.test.ts` (7 tests):
- Loop break cuando `x-agent-key` está y `x-wasiai-source` no.
- Delegación normal cuando `x-wasiai-source: v2-proxy`.
- Delegación normal cuando NO hay `x-agent-key` (cliente externo).
- Renames `tag→capabilities`, `max_price→maxPrice`, `min_reputation→minReputation`.
- A2A canonical names ganan cuando ambos están presentes.
- `q` y `limit` se preservan.
- No-op cuando no hay params v2-style.

#### Fix definitivo (futuro)
El loop-break es un mitigation patch. Cleanup permanente:

1. **Reapuntar a2a `WasiAI` registry**: cambiar `discoveryEndpoint` a
   `https://app.wasiai.io/api/v1/agents` (legacy nunca-delegado) en la tabla
   `registries` de Supabase a2a. Requiere migrar el `agentMapping` al schema
   legacy (`name`/`description`/`price_per_call`/`tags`).
2. **Endpoint dedicado v2-side**: exponer `/api/v1/capabilities/legacy` que
   NUNCA delegue, y apuntar el registry a esa ruta.

Trackeado post-hackathon — el patch actual es suficiente sin tocar Railway env
ni la DB de a2a.

#### Aplicar en
Cualquier futuro endpoint v2 que se agregue al flag `V2_DELEGATE_TO_A2A` y
coincida con el `discoveryEndpoint` de un registry registrado en a2a. Antes de
habilitar la delegación: `select * from registries where discoveryEndpoint LIKE
'%app.wasiai.io%'` o aplicar el patrón `isA2ARegistryCallback()` en el handler
proxy.
