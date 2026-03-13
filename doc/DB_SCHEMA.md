# DB_SCHEMA.md — Referencia Canónica de Columnas

> **Uso:** Consultado OBLIGATORIAMENTE por Builders y Spec Reviewers antes de escribir SQL o queries.
> Última actualización: 2026-03-13

---

## Tabla `agent_calls` (renombrada de `model_calls` en migration 006)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID | PK |
| `agent_id` | UUID | FK → agents.id (era model_id antes del rename) |
| `caller_agent_id` | TEXT | slug del agente A2A caller (era agent_id antes del rename) |
| `caller_id` | UUID | FK → auth.users (null si es agent call) |
| `caller_type` | TEXT | 'human' \| 'agent' |
| `amount_paid` | NUMERIC(18,6) | |
| `tx_hash` | TEXT | |
| `status` | TEXT | 'success' \| 'error' |
| `latency_ms` | INT | puede ser null |
| `called_at` | TIMESTAMPTZ | ⚠️ **NO es `created_at`** — es `called_at` |
| `on_chain_recorded` | BOOLEAN | |
| `on_chain_tx_hash` | TEXT | |
| `caller_wallet` | TEXT | |
| `called_by_agent` | TEXT | slug del agente que hizo la llamada |

**⚠️ GOTCHA CRÍTICO:** El timestamp de creación en `agent_calls` es `called_at`, NO `created_at`.

---

## Tabla `agents`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID | PK |
| `slug` | TEXT | único, URL-friendly |
| `name` | TEXT | |
| `description` | TEXT | |
| `category` | TEXT | |
| `agent_type` | TEXT | 'model' \| 'agent' \| 'workflow' |
| `price_per_call` | NUMERIC | |
| `currency` | TEXT | |
| `chain` | TEXT | |
| `registration_type` | TEXT | 'on_chain' \| 'off_chain' |
| `on_chain_registered` | BOOLEAN | |
| `total_calls` | BIGINT | |
| `is_featured` | BOOLEAN | |
| `status` | TEXT | 'active' \| 'inactive' |
| `capabilities` | JSONB | |
| `cover_image` | TEXT | |
| `creator_wallet` | TEXT | |
| `created_at` | TIMESTAMPTZ | ✅ aquí SÍ es `created_at` |
| `updated_at` | TIMESTAMPTZ | |
| `reputation_score` | NUMERIC(5,2) | nullable |
| `is_verified` | BOOLEAN | default false (migration 047) |
| `last_health_check_ok` | BOOLEAN | nullable (migration 047) |
| `last_health_check_at` | TIMESTAMPTZ | nullable (migration 047) |

---

## Tabla `agent_keys`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK → auth.users |
| `key_hash` | TEXT | hash de la API key |
| `budget_usdc` | NUMERIC | presupuesto total asignado |
| `spent_usdc` | NUMERIC | lo gastado hasta ahora |
| `is_active` | BOOLEAN | |
| `created_at` | TIMESTAMPTZ | |

---

## Tabla `pipeline_executions`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID | PK |
| `key_id` | UUID | FK → agent_keys |
| `status` | TEXT | |
| `created_at` | TIMESTAMPTZ | |

---

## RPCs relevantes

| Función | Descripción |
|---|---|
| `deduct_key_balance(p_key_id UUID, p_amount NUMERIC)` | Debita de agent_keys.spent_usdc (migration 017) |
| `refund_key_balance(p_key_id UUID, p_amount NUMERIC) RETURNS BOOLEAN` | Reembolsa a agent_keys.spent_usdc (migration 045) |
| `get_agent_percentile_metrics(p_agent_id UUID)` | p50/p95/error_rate (migration 046) |
| `discover_agents_v2(p_category, p_max_price, p_limit)` | Discovery con métricas (migration 046) |
| `refund_sandbox_balance(p_user_id UUID, p_amount NUMERIC)` | Reembolso sandbox (migration 032) |

---

## Convenciones de naming

| Patrón | Regla |
|---|---|
| Timestamp de creación | `created_at` en la mayoría de tablas EXCEPTO `agent_calls` que usa `called_at` |
| Timestamp de actualización | `updated_at` |
| Soft delete | `status = 'inactive'` (no DELETE) |
| Booleanos | prefijo `is_` (is_active, is_verified, is_featured) |
