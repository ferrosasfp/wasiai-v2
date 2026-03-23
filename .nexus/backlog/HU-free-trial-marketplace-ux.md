# HU: Free Trial UX en Marketplace

## Historia de Usuario

**Como** usuario del marketplace de WasiAI,
**quiero** ver claramente qué agentes ofrecen free trial y poder probarlos sin pagar,
**para** evaluar la calidad del agente antes de comprar créditos USDC.

## Contexto

El backend de free trial ya está implementado (commit `7730fc578`):
- Agentes con `free_trial_enabled: true` permiten N llamadas gratis
- Requiere usuario autenticado (Supabase JWT) — no funciona anónimo
- Trackea uso en `agent_trials` por `user_id` + `agent_id`
- Respuesta incluye `meta.free_trial: { used, limit }`

**Lo que falta:** la UI del marketplace no muestra que hay free trial disponible, y no hay flujo para que un usuario no-registrado sepa que puede probarlo si se registra.

## Criterios de Aceptación (EARS)

### Marketplace Cards
- **WHEN** un agente tiene `free_trial_enabled: true`, **THEN** su card en el marketplace muestra un badge "Free Trial" (ej: "🆓 5 free calls")
- **WHEN** el usuario está autenticado y tiene trial disponible, **THEN** el badge muestra "X/5 free calls remaining"
- **WHEN** el trial está agotado, **THEN** el badge cambia a "Trial used" en gris

### Agent Detail Page
- **WHEN** un agente tiene free trial, **THEN** la página de detalle muestra una sección "Try it free" con:
  - Contador de llamadas restantes
  - Botón "Try Now" que ejecuta una llamada de prueba con input de ejemplo
  - Si no está autenticado: "Sign up to try for free" con link a registro
- **WHEN** el usuario hace click en "Try Now", **THEN** se ejecuta `POST /invoke` con el JWT del usuario y muestra el resultado inline

### Sandbox Mode (separado de free trial)
- **WHEN** un agente tiene `sandbox_enabled: true`, **THEN** existe un modo sandbox que:
  - Devuelve datos mock/ejemplo sin ejecutar el agente upstream
  - No consume el free trial counter
  - Se activa con header `X-Sandbox: true` o query param `?sandbox=true`
- **WHEN** sandbox está habilitado, **THEN** la respuesta incluye `meta.sandbox: true`

### API Responses
- **WHEN** un usuario no autenticado intenta free trial, **THEN** recibir 401 con:
  ```json
  {
    "error": "auth_required_for_trial",
    "message": "Sign up at app.wasiai.io to get free trial access",
    "free_trial": { "available": true, "limit": 5 }
  }
  ```
- **WHEN** trial agotado y sin pago, **THEN** recibir 402 con trial info:
  ```json
  {
    "free_trial": { "used": 5, "limit": 5, "exhausted": true }
  }
  ```

## Scope IN
- Badge de free trial en marketplace cards
- Sección "Try it free" en agent detail
- Sandbox mode backend (mock response, no upstream call)
- Sandbox mode UI toggle en agent detail
- Indicador de trial restante para usuarios autenticados

## Scope OUT
- No cambiar el flujo de pago existente (x402, agent-key)
- No cambiar el registro de usuarios
- No implementar CAPTCHA (el auth por JWT es suficiente por ahora)
- No cambiar el free_trial_limit por usuario (es global por agente)

## Notas Técnicas
- `free_trial_enabled`, `free_trial_limit`, `sandbox_enabled` ya existen como columnas en `agents`
- `agent_trials` ya tiene la estructura: `{ user_id, agent_id, times_used, used_at }`
- El invoke route ya tiene Route C (free trial) implementado — falta el sandbox
- Para sandbox: el invoke debería retornar `agent.example_output` o `{ "sandbox": true, "message": "This is a sandbox response" }` sin llamar al upstream
- Cards del marketplace están en `src/components/marketplace/` (verificar path exacto)

## Prioridad
Media — mejora UX significativa para conversión de nuevos usuarios

## Dependencias
- ✅ Backend free trial (ya implementado)
- ⬜ Sandbox mode backend
- ⬜ Marketplace UI updates
