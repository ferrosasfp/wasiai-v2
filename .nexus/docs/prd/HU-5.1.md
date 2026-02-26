# HU-5.1 — Agent-to-Agent Routing (POST /api/v1/compose)

**Épica:** E5 — Compose API  
**Estado:** S0 — Historia de Usuario (pendiente aprobación)  
**Prioridad:** P2  
**Generado:** 2026-02-26  
**Autor:** PM Agent (BMAD v6)

---

## Historia de Usuario

**Como** developer o agente autónomo con una API key válida y saldo USDC suficiente,  
**quiero** enviar un pipeline de agentes secuencial en un solo request (`POST /api/v1/compose`),  
**para** encadenar capacidades de múltiples agentes IA —donde el output de cada uno alimenta el input del siguiente— pagando automáticamente vía x402 por cada paso, sin tener que orquestar manualmente las invocaciones ni los pagos.

---

## Contexto y diferenciador

Ningún marketplace de agentes IA existente permite componer pipelines pagados atómicamente. WasiAI es el primero en ofrecer:

1. **Encadenamiento declarativo**: el caller describe la secuencia, WasiAI ejecuta.
2. **Micropagos automáticos por paso**: cada invocación descuenta del `keyBalance[keyId]` del caller.
3. **Propagación de output→input**: el response de cada agente se pasa como `input` al siguiente sin intervención del caller.
4. **Recibo criptográfico del pipeline completo**: un receipt ECDSA por pipeline + receipts individuales por paso.

Este feature convierte WasiAI de un directorio de agentes en una plataforma de composición de IA.

---

## Acceptance Criteria

Los siguientes criterios son verificables y no ambiguos. Todos deben pasar para que la HU esté DONE.

### AC-1 — Endpoint y autenticación
- [ ] `POST /api/v1/compose` existe y responde.
- [ ] Requiere header `X-API-Key: <key>` válida; sin key válida → `401 Unauthorized`.
- [ ] La key debe tener `status = 'active'` en DB; key inactiva → `403 Forbidden`.
- [ ] Rate limit: máx 10 pipelines/minuto por key (Upstash Redis, prefix `wasiai:compose`).

### AC-2 — Payload de entrada
- [ ] El body acepta un array `steps` de 2–10 elementos (menos de 2 o más de 10 → `400 Bad Request` con mensaje explícito).
- [ ] Cada `step` tiene al menos: `agent_id` (UUID válido) y `input` (string o objeto JSON).
- [ ] Si `input` del step N>1 es el literal `"$prev"`, se sustituye por el output del step anterior.
- [ ] Campos desconocidos en el body son ignorados silenciosamente (no rompen el request).
- [ ] Body malformado (JSON inválido) → `400 Bad Request`.

```json
// Ejemplo de payload válido
{
  "steps": [
    { "agent_id": "<uuid>", "input": "Resume este contrato legal: ..." },
    { "agent_id": "<uuid>", "input": "$prev" },
    { "agent_id": "<uuid>", "input": { "text": "$prev", "format": "json" } }
  ]
}
```

### AC-3 — Validación previa (pre-flight)
- [ ] Antes de ejecutar cualquier paso, se verifica que todos los `agent_id` existen y tienen `status = 'active'` en DB. Si alguno no existe o está inactivo → `422 Unprocessable Entity` con array de `invalid_agents`.
- [ ] Se calcula el costo estimado total del pipeline (`sum(price_per_call)` de cada agente). Si `keyBalance[keyId] < costo_estimado` → `402 Payment Required` con `{ required, available, currency: "USDC" }`.
- [ ] Pre-flight completo sin llamadas a agentes externos.

### AC-4 — Ejecución secuencial
- [ ] Los pasos se ejecutan en orden estricto: el paso N+1 no inicia hasta que el paso N responde exitosamente.
- [ ] Cada paso invoca el endpoint del agente usando su `endpoint_url` registrado en DB.
- [ ] La URL del agente se valida con `validateUrl()` (SSRF protection) antes de cada llamada.
- [ ] Cada paso aplica timeout configurable por env var `COMPOSE_STEP_TIMEOUT_MS` (default: 30 000 ms). Timeout → el pipeline se aborta, pasos ejecutados se cobran, pasos pendientes no.
- [ ] El output del agente en el paso N se extrae del campo `response` del body de respuesta del agente (o del body completo si `response` no existe).

### AC-5 — Pagos por paso
- [ ] Por cada paso completado exitosamente, se descuenta `price_per_call` del `keyBalance[keyId]` en DB (operación atómica).
- [ ] El descuento ocurre **después** de recibir respuesta exitosa del agente, no antes.
- [ ] Si el pago de un paso falla (saldo insuficiente en mitad del pipeline): el pipeline se aborta, se devuelve `402` con los pasos completados hasta ese punto y el saldo restante.
- [ ] La columna `agent_calls` registra cada paso individualmente con `pipeline_id` vinculado.
- [ ] Se registra `is_trial = false` en todos los `agent_calls` del pipeline.

### AC-6 — Respuesta exitosa
- [ ] HTTP `200 OK` con body:
```json
{
  "pipeline_id": "<uuid>",
  "steps_completed": 3,
  "steps_total": 3,
  "result": "<output del último paso>",
  "steps": [
    {
      "step": 1,
      "agent_id": "<uuid>",
      "input": "...",
      "output": "...",
      "latency_ms": 1240,
      "cost_usdc": "0.05"
    }
  ],
  "total_cost_usdc": "0.15",
  "receipt_signature": "<ECDSA hex>"
}
```
- [ ] `receipt_signature` es una firma ECDSA del operator sobre `keccak256(pipeline_id + caller_key_id + total_cost_usdc + timestamp)`.

### AC-7 — Manejo de errores parciales
- [ ] Si un agente externo responde con error (4xx/5xx), el pipeline se aborta en ese paso.
- [ ] Respuesta `502 Bad Gateway` con:
```json
{
  "pipeline_id": "<uuid>",
  "failed_at_step": 2,
  "steps_completed": 1,
  "error": "Agent <uuid> returned 500",
  "result_so_far": "<output del paso 1>",
  "total_cost_usdc": "0.05"
}
```
- [ ] Los pasos completados antes del fallo **sí se cobran** (trabajo real realizado).
- [ ] El paso fallido **no se cobra**.

### AC-8 — Seguridad
- [ ] El endpoint usa `createServiceClient()` (service role) — nunca `createServerClient()` para las operaciones de balance.
- [ ] No hay ninguna secret/key en variables `NEXT_PUBLIC_`.
- [ ] No hay valores hardcodeados (agentes, precios, timeouts) — todo desde env vars o DB.
- [ ] Headers de respuesta del agente externo no se propagan al caller (prevención de header injection).
- [ ] Payload del agente externo se valida como JSON antes de pasar al siguiente paso; si no es parseable, se pasa como string.

### AC-9 — Observabilidad
- [ ] Cada pipeline genera un `pipeline_id` (UUID v4) trazable en logs.
- [ ] Tabla `pipeline_executions` registra: `id`, `key_id`, `steps_requested`, `steps_completed`, `total_cost_usdc`, `status` (`success|partial|failed`), `created_at`.
- [ ] Logs estructurados por paso (no `console.log` sueltos): `{ pipeline_id, step, agent_id, latency_ms, status }`.

---

## Scope

### ✅ Incluye esta HU

| # | Qué |
|---|-----|
| 1 | Endpoint `POST /api/v1/compose` |
| 2 | Validación de payload (steps array, agent_ids, input) |
| 3 | Pre-flight check: agentes activos + saldo suficiente |
| 4 | Ejecución secuencial con propagación `$prev` |
| 5 | Descuento de balance por paso completado |
| 6 | SSRF protection en cada llamada a agente externo |
| 7 | Rate limiting (Upstash Redis) |
| 8 | Registro en `agent_calls` con `pipeline_id` |
| 9 | Tabla nueva `pipeline_executions` (migration 017) |
| 10 | Receipt ECDSA del pipeline completo |
| 11 | Respuesta parcial en caso de fallo mid-pipeline |

### ❌ Fuera de scope (ver sección Out of Scope)

- Ejecución paralela / branching / DAG
- UI para construir pipelines visualmente
- SDK `@wasiai/sdk` (E2 — separado)
- Agentes que se invocan entre sí recursivamente
- Webhooks de notificación al terminar
- Replay automático de pipelines fallidos
- Pipeline templates guardados en DB
- Soporte x402 con wallet humana (solo API key en esta HU)

---

## Out of Scope explícito

| Ítem | Razón |
|------|-------|
| **Ejecución paralela de pasos** | Aumenta complejidad de manejo de errores y pagos exponencialmente. Roadmap E5.2. |
| **DAG / branching condicional** | Requiere DSL propio. Roadmap E5.3. |
| **UI visual de pipelines** | Frontend separado. Roadmap E5.4. |
| **SDK `@wasiai/sdk`** | HU-2.x — épica separada. |
| **Pipelines vía wallet humana (x402 EIP-712)** | Flujo de firma manual no es compatible con pipelines síncronos. Solo API key. |
| **Webhooks async** | Pipeline es síncrono en esta versión. |
| **Retry automático de pasos fallidos** | Introduce ambigüedad en cobros. Decisión explícita: falla rápido, cobra lo ejecutado. |
| **Caché de outputs de pasos** | Optimización futura. |
| **Mainnet** | Bloqueado hasta E6. Solo Fuji. |
| **Agentes de terceros (URLs externas no registradas en WasiAI)** | Solo agentes con `agent_id` registrado en el marketplace. |

---

## Riesgos identificados

| ID | Riesgo | Probabilidad | Impacto | Mitigación |
|----|--------|-------------|---------|------------|
| R1 | Agente externo lento/colgado bloquea el pipeline y consume recursos del servidor | Alta | Alto | `COMPOSE_STEP_TIMEOUT_MS` estricto + abort signal en fetch. |
| R2 | Output de agente N es muy grande (>1MB) y se pasa como input al agente N+1, causando OOM o request rechazado | Media | Alto | Límite de tamaño de output por paso: `COMPOSE_MAX_STEP_OUTPUT_BYTES` (default: 100KB). Si excede → pipeline abort con `413`. |
| R3 | Race condition: dos requests simultáneos decrementan el mismo `keyBalance` por debajo de cero | Media | Alto | UPDATE atómico con `WHERE balance >= price_per_call`; si 0 rows updated → abort con 402. |
| R4 | Un agente malicioso registrado en el marketplace retorna un payload diseñado para inyectar contenido en el siguiente agente (prompt injection entre pasos) | Media | Medio | WasiAI no puede garantizar contenido semántico. Documentar en ToS y en docs de la API que los outputs son pasados tal cual. |
| R5 | `pipeline_executions` tabla nueva puede no estar en producción si migration 017 no está aplicada | Baja | Alto | Checklist de deploy: verificar migration antes de activar endpoint. |
| R6 | Agente registrado con `endpoint_url` que apunta a infraestructura interna (SSRF) | Baja | Crítico | `validateUrl()` obligatorio antes de cada invocación. Deny list de IPs privadas activa. |
| R7 | Costo del pipeline calculado en pre-flight difiere del costo real (si un agente cambió de precio entre pre-flight y ejecución) | Baja | Medio | Precio se re-lee de DB por cada paso en el momento de ejecutar, no se cachea del pre-flight. |
| R8 | Latencia total del pipeline (suma de steps) supera el timeout de Vercel (30s en plan hobby) | Media | Alto | Evaluar si se necesita plan Pro o mover compose a Edge Function con streaming. Decisión antes de Sprint 3. |

---

## Dependencias

| Depende de | Tipo | Notas |
|------------|------|-------|
| HU-1.1 — API Keys | Bloqueante | Sistema de keys + `keyBalance` ya implementado (Sprint 1) |
| HU-1.2 — Agent Invoke | Bloqueante | Patrón de invocación + cobro por paso reutilizable |
| HU-2.x — SDK | No bloqueante | SDK puede envolver compose después |
| Migration 017 | Bloqueante | Nueva tabla `pipeline_executions` |

---

## Preguntas abiertas (para S1)

1. **Vercel timeout**: ¿Pipeline síncrono o async con polling? Decidir antes de S1.
2. **Formato de `$prev`**: ¿Solo string literal o también path notation (`$prev.field.subfield`)? Define el poder expresivo del pipeline.
3. **¿Se expone el pipeline en el dashboard del creator?** Los creators necesitan ver cuánto de su revenue viene de pipelines vs invocaciones directas.
4. **¿Límite de 10 steps es suficiente?** Basado en Vercel timeout. Revisar si se migra a async.
5. **¿El `pipeline_id` se expone en `agent_calls`?** Necesario para trazabilidad en el dashboard.

---

## Notas de implementación (para el Arquitecto en S1)

- Ruta: `src/app/api/v1/compose/route.ts`
- Auth: `createServiceClient()` — machine-to-machine
- No usar `createServerClient()` (no hay sesión de usuario en este endpoint)
- Cada fetch a agente externo debe llevar `AbortController` con el timeout
- El `receipt_signature` usa `getOperatorClient()` de `@/lib/viem` para firmar
- La migration 017 debe crear `pipeline_executions` con FK a `api_keys`
- Agregar `pipeline_id` como columna nullable a `agent_calls` (migration 017 también)

---

## Definición de DONE para S0

- [ ] Este documento revisado y aprobado por Fer (**HU_APPROVED explícito**)
- [ ] Preguntas abiertas respondidas o decididas como fuera de scope
- [ ] Listo para pasar a S1 (spec técnica + Implementation Readiness Check)
