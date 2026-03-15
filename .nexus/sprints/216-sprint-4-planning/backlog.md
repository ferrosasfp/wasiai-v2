# Sprint 4 — Backlog Priorizado
> Fecha: 2026-03-14 | SM: San | Metodología: NexusAgil v1.3

## Issues seleccionados

| # | Issue | Tipo | Prioridad | Estado | Resumen |
|---|-------|------|-----------|--------|---------|
| 1 | WAS-213 | BUG | 🟠 High | Backlog | `reputation_score` null en todos los agentes — `min_reputation` filter inoperativo |
| 2 | WAS-197 | HU | 🔴 Urgent | Backlog | AgentKit — ejemplo funcional Coinbase AgentKit + WasiAI con x402 |
| 3 | WAS-186 | HU | 🟠 High | Todo | Agent Key scoping por slug o categoría (ACs ya revisados por RR) |
| 4 | WAS-196 | HU | 🟠 High | In Progress | Sandbox opt-in/out por agente (ACs ya revisados por RR) |
| 5 | WAS-200 | HU | 🟠 High | Backlog | Input Schema estructurado + validación pre-cobro (ACs ya revisados por RR) |

## Dependencias

- WAS-186 → independiente (agent_keys scoping)
- WAS-196 → independiente (agents sandbox column)
- WAS-200 → depende de tener agentes registrados (WAS-215 ✅ done)
- WAS-213 → depende de agent_calls tener data (prod)
- WAS-197 → independiente (ejemplo externo, no toca DB prod)

## Clasificaciones NexusAgil

| Issue | Clasificación | Razón |
|-------|--------------|-------|
| WAS-213 | QUALITY | Bug con DB + potencial migración |
| WAS-197 | HU-MAJOR | Feature nueva con código externo (AgentKit) |
| WAS-186 | QUALITY | Auth + DB migration + seguridad |
| WAS-196 | HU-MAJOR | DB migration + UI + endpoint |
| WAS-200 | QUALITY | Validación pre-cobro + SSRF |

## Work Items

### WAS-213 — BUG: reputation_score null

**Contexto:** `reputation_score` es NULL en todos los agentes. El campo existe (migration 047) pero nunca se popula. `GET /api/v1/agents?min_reputation=X` siempre retorna 0 resultados. Impacta la Discovery API (WAS-209).

**Solución elegida:** Opción A — calcular desde `agent_calls` via función `get_agent_percentile_metrics` (ya existe en migration 046). Crear job/trigger que actualiza el campo al completar una invocación.

**ACs (EARS):**
- AC1: WHEN una invocación completa exitosamente, THE system SHALL recalcular `reputation_score` del agente via `get_agent_percentile_metrics(agent_id)` y actualizar `agents.reputation_score`.
- AC2: WHEN `GET /api/v1/agents?min_reputation=0.5`, THE endpoint SHALL retornar solo agentes con `reputation_score >= 0.5`.
- AC3: WHEN ningún agente tiene `reputation_score` calculado, THE seed script SHALL poblar agentes demo con valores entre 0.6-0.99.
- AC4: WHEN `get_agent_percentile_metrics` falla, THE system SHALL loggear el error y NO fallar la invocación principal.
- AC5: WHEN un agente tiene 0 invocaciones, `reputation_score` SHALL permanecer NULL (no 0).

**Scope IN:** Trigger/función DB que actualiza `reputation_score` post-invocación, seed script para agentes demo, fix del filtro si está roto.
**Scope OUT:** UI de reputación, on-chain reputation (WAS-191), dispute resolution (WAS-189).

---

### WAS-197 — AgentKit + WasiAI

**Contexto:** Hackathon Avalanche Build Games Stage 3. Necesitamos un ejemplo funcional de Coinbase AgentKit llamando a WasiAI con pagos x402 para demostrar que somos infraestructura real de la economía agéntica.

**ACs (EARS):**
- AC1: WHEN un AgentKit agent invoca un agente WasiAI sin Agent Key, THE x402 payment flow SHALL completarse on-chain en Avalanche C-Chain con USDC.
- AC2: WHEN el pago x402 se procesa, THE AgentKit agent SHALL recibir la respuesta del agente WasiAI y usarla en su razonamiento.
- AC3: WHEN el ejemplo se ejecuta, THE output SHALL mostrar: tx hash, latencia, resultado del agente.
- AC4: WHEN el ejemplo está en el repo, THE README SHALL tener instrucciones de setup en <5 pasos.
- AC5: WHEN el juez visita el repo, THE código SHALL estar en `examples/agentkit-wasiai/`.

**Scope IN:** Ejemplo funcional Node.js con AgentKit + WasiAI x402, README, script de demo.
**Scope OUT:** UI, nuevo endpoint en WasiAI, cambios en el contrato.

---

### WAS-186 — Agent Key Scoping

**ACs (ya revisados por RR, tomados de Linear):**
- AC1: WHEN migration 053 aplicada, `agent_keys` SHALL tener `allowed_slugs TEXT[]` y `allowed_categories TEXT[]` nullable.
- AC2: WHEN key creada con `allowed_slugs`, THE sistema SHALL validar que los slugs existen — slugs inexistentes retornan 422.
- AC3: WHEN key tiene AMBOS `allowed_slugs` y `allowed_categories`, THE lógica SHALL ser OR (union).
- AC4: WHEN key con scope intenta invocar agente fuera del scope, THE endpoint SHALL retornar 403 `{ error: "agent_not_in_scope" }`.
- AC5: WHEN key sin scope (null/null), THE key SHALL funcionar para TODOS los agentes (comportamiento actual).
- AC6: WHEN creator crea key vía dashboard, THE UI SHALL mostrar campos opcionales de scope.

**Scope IN:** Migración DB, lógica de validación en invoke endpoint, UI de creación de keys.
**Scope OUT:** Scoping por categoría en discovery, rate limits por scope.

---

### WAS-196 — Sandbox opt-in/out

**ACs (ya revisados por RR, tomados de Linear):**
- AC1: WHEN migration 051 aplicada, `agents` SHALL tener `sandbox_enabled BOOLEAN NOT NULL DEFAULT TRUE`.
- AC2: WHEN creador edita agente, THE UI SHALL mostrar checkbox con nota de costos de infraestructura.
- AC3: WHEN sandbox route recibe invocación y `sandbox_enabled=false`, THE endpoint SHALL retornar HTTP 403 `{ error: "Sandbox disabled by creator", code: "sandbox_disabled" }`.
- AC4: WHEN `sandbox_enabled=true` (default), THE comportamiento actual SHALL mantenerse sin cambios.
- AC5: WHEN `GET /api/v1/agents/:slug`, THE response SHALL incluir campo `sandbox_enabled`.

**Scope IN:** Migración DB, lógica en sandbox endpoint, UI checkbox, campo en response.
**Scope OUT:** Sandbox billing, sandbox logs UI.

---

### WAS-200 — Input Schema + Validación pre-cobro

**ACs (ya revisados por RR, tomados de Linear):**
- AC1: WHEN migration 055 aplicada, `agents` SHALL tener `input_schema JSONB nullable`.
- AC2: WHEN creador guarda `input_schema`, THE sistema SHALL meta-validar que es JSON Schema draft-07 válido — schema inválido retorna 422.
- AC3: WHEN `input_schema` contiene `$ref` con URL http/https, THE sistema SHALL rechazar con 422 `{ code: "schema_ssrf_blocked" }`.
- AC4: WHEN `POST /api/v1/agents/:slug/invoke` recibe input y el agente tiene `input_schema`, THE sistema SHALL validar el input ANTES de cobrar — input inválido retorna 422 sin cobrar.
- AC5: WHEN `input_schema` es null, THE validación SHALL ser omitida (comportamiento actual).
- AC6: WHEN `GET /api/v1/agents/:slug`, THE response SHALL incluir `input_schema` si existe.

**Scope IN:** Migración DB, validación en invoke endpoint, meta-validación de schema al guardar, SSRF en $ref.
**Scope OUT:** UI de schema builder, output schema (WAS-209 ya lo tiene), schema versioning.
