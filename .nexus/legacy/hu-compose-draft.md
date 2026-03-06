# HU-5.1 — Agent Compose: Pipeline Secuencial con Pago x402 por Paso

> **Artefacto S0 — Product Manager**
> Épica 5 — Agent-to-Agent Routing
> Fecha: 2026-02-28 | Semana 3 — Hackathon Avalanche Build Games
> Estado: DRAFT — pendiente HU_APPROVED de Fer

---

## Historia de Usuario

**Como** agente autónomo (o developer con API key),
**quiero** invocar un pipeline de múltiples agentes IA en una sola llamada HTTP,
**para que** WasiAI orqueste y pague cada paso automáticamente on-chain, sin que yo necesite saber cuántos agentes intermedios existen ni gestionar los pagos individuales.

---

## Contexto de Negocio

WasiAI ya tiene x402 funcionando para invocar **un** agente. El Compose es el salto a **agentes que coordinan agentes** — el diferenciador real del marketplace.

**Flujo ejemplo:**
```
POST /api/v1/compose
{
  "steps": [
    { "agent_slug": "ocr-reader",         "input": "<image_url>" },
    { "agent_slug": "translator-es",      "pass_output": true },
    { "agent_slug": "sentiment-analyzer", "pass_output": true }
  ]
}

→ WasiAI ejecuta en secuencia:
   Step 1: ocr-reader        → extrae texto  → paga 0.008 USDC on-chain
   Step 2: translator-es     → traduce texto → paga 0.002 USDC on-chain
   Step 3: sentiment-analyzer → analiza      → paga 0.001 USDC on-chain

→ Response: output del Step 3 + receipt del pipeline
```

Cada pago es una tx real en Fuji. Sin humano. Sin que el caller conozca los agentes internos.

---

## Scope

### ✅ IN SCOPE (HU-5.1)

- Endpoint `POST /api/v1/compose` con autenticación por API key (header `X-Api-Key`)
- Ejecución **secuencial** de hasta **5 agentes** por pipeline
- Modo `pass_output: true` — el output del step N se convierte en input del step N+1
- Modo `input` explícito por step — cada step recibe su propio input
- Pago x402 en **cada step** vía `keyBalances[keyId]` (mismo mecanismo que `/invoke`)
- Validación de saldo suficiente ANTES de iniciar la cadena (preflight check)
- Logging individual de cada step en `agent_calls` con `pipeline_id` como correlación
- Response final: `{ pipeline_id, steps_executed, total_cost_usdc, result, receipts[] }`
- Rate limiting: Upstash Redis (límite conservador por key en fase inicial)
- SSRF protection en los `endpoint_url` de cada agente
- Solo **Fuji** (chainId 43113) en esta HU
- Ejecución **síncrona** (timeout 25s — Vercel limit)

### ❌ OUT OF SCOPE (HU-5.1)

- Ejecución paralela de agentes → HU-5.2
- Routing inteligente por precio/latencia → HU-5.3
- UI visual de pipelines → HU-5.4
- Async con polling (pipeline_id) → HU-5.1b (post-hackathon)
- Mainnet → HU-6.x
- Agents que definen su propio compose (recursión) → roadmap
- Webhooks de completion → roadmap

---

## Acceptance Criteria

> Formato: [ID] Descripción — verificable sin ambigüedad.

**AC-1 — Endpoint disponible y autenticado**
`POST /api/v1/compose` responde `401` si falta `X-Api-Key` o la key no existe.
Con key válida, responde `200` (pipeline ejecutado) o código de error apropiado.

**AC-2 — Pipeline secuencial con pass_output**
Dado un pipeline de 3 agentes con `pass_output: true`, el output del step 1 llega como input al step 2, y el output del step 2 llega como input al step 3.
El resultado final (`result`) es el output del último step.

**AC-3 — Pago x402 on-chain en CADA step**
Cada step ejecutado genera una transacción real en Fuji que descuenta de `keyBalances[keyId]`.
El campo `receipts[]` en la response contiene un receipt firmado por step (mismo formato que `/invoke`).
Verificable: el saldo de la key disminuye exactamente en `sum(agent.price_usdc)` después del pipeline.

**AC-4 — Preflight de saldo**
Antes de ejecutar cualquier step, el sistema suma `price_usdc` de todos los agentes del pipeline.
Si el saldo disponible de la key es insuficiente → responde `402` con `{ error: "Insufficient balance", required_usdc: X, available_usdc: Y }`. No se ejecuta ningún step, no se cobra nada.

**AC-5 — Fallo en step intermedio → rollback de ejecución**
Si el step N falla (timeout, error del agente externo, error de pago), el pipeline se detiene.
Response: `422` con `{ error: "Pipeline failed at step N", steps_executed: N-1, partial_receipts: [...], reason: "..." }`.
Los steps N+1..fin no se ejecutan ni se cobran.
Los steps 1..N-1 ya ejecutados **no se reembolsan** (el caller asume el riesgo — documentado).

**AC-6 — Logging con correlación por pipeline**
Cada step genera un registro en `agent_calls` con:
- `pipeline_id` (UUID del pipeline, igual para todos los steps de esa ejecución)
- `step_index` (0-based)
- `is_trial: false` (compose nunca es trial)
- `status: 'success' | 'error'`
- `latency_ms` real del step

**AC-7 — Validación de inputs**
- `steps` array: mínimo 1, máximo 5. Si se supera → `400 Bad Request`.
- Cada step debe tener `agent_slug` válido (agente publicado y activo en DB). Si no existe → `404`.
- `pass_output` y `input` explícito son mutuamente excluyentes en el mismo step (excepto step 0). Si hay conflicto → `400`.

**AC-8 — Rate limiting**
El endpoint aplica rate limiting por `keyId` vía Upstash Redis.
Límite inicial: 10 pipelines/minuto por key.
Si se supera → `429` con `Retry-After` header.

**AC-9 — SSRF protection**
Los `endpoint_url` de cada agente pasan por `validateUrl()` antes del fetch.
Si algún URL no pasa validación → el step falla con error `SSRF_BLOCKED`, el pipeline se detiene en ese step (aplica AC-5).

**AC-10 — Response schema documentado**
La response `200` incluye exactamente:
```json
{
  "pipeline_id": "uuid",
  "steps_executed": 3,
  "total_cost_usdc": "0.011",
  "result": "<output del último step>",
  "receipts": [
    { "step": 0, "agent_slug": "...", "cost_usdc": "0.008", "receipt_hash": "0x..." },
    { "step": 1, "agent_slug": "...", "cost_usdc": "0.002", "receipt_hash": "0x..." },
    { "step": 2, "agent_slug": "...", "cost_usdc": "0.001", "receipt_hash": "0x..." }
  ]
}
```

---

## Estimación

| Componente | Esfuerzo estimado |
|---|---|
| Schema DB (columnas `pipeline_id`, `step_index` en `agent_calls`) | 0.5 días |
| Endpoint `POST /api/v1/compose` — lógica de orquestación | 1.5 días |
| Preflight de saldo + SSRF + rate limiting | 0.5 días |
| Logging por step + receipts firmados | 0.5 días |
| Tests (unitarios + integración Fuji) | 1 día |
| **Total** | **~4 días** |

> Hackathon context: Semana 3, debe estar en Fuji antes del cierre. Prioridad P0 para demostración.

---

## Dependencias

| Dependencia | Estado | Bloqueante |
|---|---|---|
| `POST /api/v1/invoke` con x402 funcional | ✅ Completado | Sí — compose reutiliza el mecanismo de pago |
| `agent_calls` tabla con RLS activo | ✅ Migration 000-016 | Sí — logging de steps |
| `keyBalances[keyId]` on-chain operativo | ✅ Completado | Sí — saldo para pagos |
| Contrato Fuji `0x71CddCdF8a40951a1d8C22C8774448FbcA089b53` | ✅ Verificado | Sí |
| `validateUrl()` SSRF protection | ✅ Completado (HAL-014/022) | Sí |
| Migration 017 disponible | ✅ Próxima disponible | Sí — para columnas pipeline_id/step_index |
| Agentes demo publicados en Fuji (OCR, Translator, Sentiment) | ⚠️ Por confirmar | Para demo del hackathon |

---

## Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| **Timeout 25s de Vercel** — pipeline de 5 agentes lentos puede exceder el límite | Alta | Alto | Limitar a 5 steps máximo; documentar latencia esperada; HU-5.1b introduce async para pipelines largos |
| **Atomicidad de pagos** — si el pago del step N falla a mitad de tx, el saldo puede quedar inconsistente | Media | Alto | Validar saldo antes de cada step (no solo preflight global); mismo patrón `increment_key_budget` atómico de HAL-011 |
| **Agentes externos no confiables** — un agente en el pipeline puede devolver output malicioso que se pasa como input al siguiente | Media | Medio | Documentar que WasiAI no sanitiza el output entre steps; responsabilidad del builder del pipeline |
| **Demo sin agentes reales** — si no hay agentes OCR/Translator/Sentiment en Fuji, la demo del hackathon es débil | Alta | Alto | Crear agentes mock internos (endpoints propios de WasiAI) para la demo; registrarlos en el marketplace |
| **Race condition en saldo** — múltiples pipelines simultáneos desde la misma key podrían sobrepasar el saldo si el preflight no es atómico | Media | Alto | Usar RPC atómica (mismo patrón HAL-011) para el preflight + deducción, o bloquear por keyId con Redis lock |
| **Complejidad de debugging** — fallo en step 3 de 5 es difícil de trazar sin logging granular | Baja | Medio | AC-6 garantiza `pipeline_id` + `step_index` — suficiente para debugging en Semana 3 |

---

## Notas para S1 (Architect)

Estas decisiones quedan **abiertas** para el SDD — no presuponemos la implementación:

1. ¿El orquestador llama directamente al `endpoint_url` del agente, o pasa por la ruta `/invoke` interna? (directo = más rápido; vía invoke = logging unificado)
2. ¿La deducción de saldo es por step (más seguro) o una sola transacción al final (más rápido pero riesgoso)?
3. ¿`pipeline_id` se genera en el endpoint o en la capa de logging?
4. ¿Se necesita migration nueva para `pipeline_id`/`step_index` o se maneja como metadata en columna JSONB existente?

---

*Artefacto generado por San (S0 — PM) | 2026-02-28*
*Pendiente: HU_APPROVED explícito de Fer para activar GATE 1*
