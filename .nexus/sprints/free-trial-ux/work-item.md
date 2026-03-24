# Work Item — Free Trial: Sandbox Mode + A2A + Zero Duplicación

## Contexto
El free trial ya funciona vía `/api/v1/agents/{slug}/trial` (frontend). Hoy se agregó un Route C duplicado en `/models/{slug}/invoke` que hace lo mismo con lógica diferente. Eso es inaceptable — código duplicado prohibido.

**Decisión:** eliminar Route C del invoke. Un solo path de free trial: `/api/v1/agents/{slug}/trial`. Adaptarlo para A2A (body nativo) y agregar sandbox mode.

## Pre-condiciones
- `sandbox_enabled` (boolean DEFAULT false) ya existe en tabla `agents` ✅
- `payment_type: 'sandbox'` ya existe en validator ✅
- `use_trial` RPC ya existe ✅
- `AgentTrialPlayground` ya funciona con `/trial` ✅

## Acceptance Criteria (EARS)

### AC-1: Eliminar Route C del invoke
- **WHEN** un request sin `x-agent-key` ni `X-PAYMENT` llega a `/models/{slug}/invoke`
- **THEN** retorna 402 con instrucciones x402 (comportamiento original pre-Route-C)
- **AND** la respuesta incluye `free_trial_url: "/api/v1/agents/{slug}/trial"` si el agente tiene `free_trial_enabled: true` para que el caller sepa dónde ir

### AC-2: Trial endpoint acepta body nativo (A2A)
- **WHEN** POST `/agents/{slug}/trial` recibe un body que NO matchea `{ input: string }`
- **THEN** el body completo se pasa como-es al upstream (body nativo del agente)
- **AND** la respuesta cambia de `{ output: string }` a `{ output: <json del upstream> }` (ya parsea JSON si el upstream responde JSON)
- **WHEN** el body SÍ matchea `{ input: string }` (formato actual)
- **THEN** sigue funcionando como antes (backward compatible)

### AC-3: Sandbox Mode en Trial
- **WHEN** POST `/agents/{slug}/trial` incluye header `X-Sandbox: true` **AND** agente tiene `sandbox_enabled: true`
- **AND** el caller tiene JWT válido o pasa IP rate limit
- **THEN** retorna example output del agente sin llamar upstream, sin decrementar trial counter
- **AND** se loguea en `agent_calls` con `payment_type: 'sandbox'`
- **AND** respuesta incluye `{ sandbox: true }`

### AC-4: Sandbox fallback sin example_output
- **WHEN** sandbox activado pero agente no tiene example_output
- **THEN** retorna `{ output: { message: "Sandbox mode — no example output configured" }, sandbox: true }`

### AC-5: Sandbox en Invoke (header redirect)
- **WHEN** request a `/models/{slug}/invoke` incluye `X-Sandbox: true` **AND** agente tiene `sandbox_enabled: true`
- **THEN** retorna directamente el example output (sin cobrar, sin upstream)
- **AND** `meta: { sandbox: true, charged: 0 }`
- **NOTA:** este es el ÚNICO caso donde invoke no cobra — sandbox es stateless, no necesita auth JWT, no trackea nada excepto el log

### AC-6: Body schema actualizado
- **WHEN** POST `/agents/{slug}/trial` recibe body
- **THEN** el schema Zod acepta TANTO `{ input: string }` (legacy) como cualquier objeto JSON (nativo A2A)
- **AND** si `sandbox: true` está presente como query param o header, no requiere body

### AC-7: No romper frontend
- **WHEN** `AgentTrialPlayground` usa POST `/agents/{slug}/trial` con `{ input: "..." }`
- **THEN** invariantes: mismo endpoint, mismo body aceptado, misma respuesta `{ output, latencyMs }`, mismos error codes

### AC-8: 402 response incluye trial info
- **WHEN** invoke retorna 402 y el agente tiene `free_trial_enabled: true`
- **THEN** la respuesta 402 incluye `free_trial: { available: true, endpoint: "/api/v1/agents/{slug}/trial", limit: N }`

## Scope IN
- Eliminar Route C del invoke (revert commit `7730fc578`)
- Adaptar `/trial` para body nativo (A2A compatible)
- Sandbox mode en `/trial` endpoint
- Sandbox shortcut en invoke (stateless, AC-5)
- 402 response con trial info
- Actualizar Zod schema

## Scope OUT
- No cambiar UI de AgentTrialPlayground
- No cambiar badge de ModelCard
- No cambiar flujo de pago (x402, agent-key)
- No agregar CAPTCHA
- No agregar migraciones DB (todo ya existe)
