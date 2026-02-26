# HU-3.1 — Free Trial por Agente (1 llamada gratuita)

> **Estado:** HU_APPROVED ✅
> **Linear:** WAS-10
> **Sprint:** 2 (25 Feb – 28 Feb 2026)
> **Épica:** 3 — Free Trial

---

## Historia de Usuario

Como **usuario nuevo** que descubrió un agente en el marketplace,
quiero poder probar el agente con una llamada gratuita antes de comprar una API key,
para confirmar que hace lo que dice antes de gastar USDC.

---

## Criterios de Aceptación

- [ ] **AC1:** En la ficha de cada agente (`/[locale]/agents/[slug]`), existe un "Playground" o sección "Probar gratis" con:
  - Campo de texto: "Tu input"
  - Botón "Probar gratis"
  - Área de resultado (output del agente)

- [ ] **AC2:** Cada usuario autenticado puede hacer **máximo 1 llamada gratuita por agente** (no por día — es lifetime por par usuario+agente).
  - Si ya usó su trial, el botón cambia a "Ya probaste este agente" + CTA "Obtener API key"
  - Si no está autenticado, el botón dice "Inicia sesión para probar gratis"

- [ ] **AC3:** El trial NO requiere API key ni USDC. El costo de la llamada lo absorbe WasiAI (desde el operator wallet).

- [ ] **AC4:** Rate limiting estricto para evitar abuso:
  - 1 trial por par (user_id, agent_slug) — verificado en DB
  - Upstash Redis: máximo 3 intentos de trial por IP por hora (para usuarios no autenticados que intentan registrarse múltiples veces)
  - Timeout de 8 segundos en la llamada al agente

- [ ] **AC5:** La llamada de trial pasa por el mismo pipeline de invocación que una llamada paga, excepto:
  - No descuenta saldo de ninguna key
  - No ejecuta settlement on-chain
  - Sí loguea en `agent_calls` con `is_trial = true`

- [ ] **AC6:** El creator **no pierde earnings** por trials — WasiAI los subsidia desde el operator wallet. (En el MVP: simplemente no se registra revenue por trials. En el futuro, WasiAI puede compensar al creator.)

- [ ] **AC7:** El output se muestra en la UI en < 10 segundos o muestra error claro: "El agente tardó demasiado. Intenta más tarde."

- [ ] **AC8:** Si el endpoint del agente retorna error (4xx/5xx), se muestra: "El agente encontró un error. Puede ser temporal." — sin exponer el cuerpo del error al usuario (seguridad).

---

## Scope

### In scope
- UI de playground en la ficha del agente
- Endpoint `POST /api/v1/agents/[slug]/trial`
- Verificación de 1 trial por (user_id, agent_slug) en DB
- Rate limiting anti-abuso por IP
- Log en `agent_calls` con flag `is_trial`
- Timeout + error handling

### Out of scope
- Trials sin autenticación (se requiere login)
- Múltiples rondas de conversación (solo input/output simple)
- Historial de trials del usuario
- Compensar al creator por trials (roadmap)
- Probar agentes con archivos/imágenes como input

---

## Diseño / UX

- El playground está en la ficha del agente, debajo de la descripción y encima de "Obtener API key"
- Input: textarea simple, placeholder contextual si el agente tiene `capabilities.input_example`
- Output: bloque de código o texto plano según el content-type del agente
- Estado de carga: spinner + "Invocando agente..."
- CTA post-trial: "¿Te gustó? Obtén tu API key y úsalo sin límites" → link a purchase flow

---

## Schema DB (migration 016)

```sql
-- Agregar columna is_trial a agent_calls (si no existe)
ALTER TABLE agent_calls ADD COLUMN IF NOT EXISTS is_trial BOOLEAN DEFAULT FALSE;

-- Tabla para rastrear trials usados
CREATE TABLE IF NOT EXISTS agent_trials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, agent_id)
);

-- RLS: solo el propio usuario puede ver sus trials
ALTER TABLE agent_trials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user sees own trials" ON agent_trials
  FOR SELECT USING (auth.uid() = user_id);
```

---

## Notas técnicas

- El endpoint `/api/v1/agents/[slug]/trial` usa `createServiceClient()` para insertar en `agent_trials`
- La llamada al agente usa el mismo `fetch` con timeout que HU-1.3 (test-endpoint) — reusar lógica
- El body de la respuesta del agente se retorna al cliente (es el output del trial) — no es igual que test-endpoint donde no se expone el body
- Sin x402 payment headers — la llamada es directa, no pasa por el facilitador
- El operator wallet NO firma nada en el trial — no hay on-chain activity
- Upstash key: `trial:ip:{ip}` → incr con TTL 3600
