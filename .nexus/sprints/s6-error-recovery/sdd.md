# SDD #S6-01: Error Recovery Post-Settlement

> SPEC_APPROVED: no
> Fecha: 2026-03-15
> Tipo: feature
> SDD_MODE: full
> Branch: feat/s6-01-error-recovery

---

## 1. Resumen

Cuando el settler x402 cobra USDC al usuario exitosamente pero el upstream (modelo de IA) falla, el usuario pierde dinero sin recibir servicio. Actualmente esto se registra con `status='error'` en `agent_calls` pero no hay compensación ni registro especializado. Este SDD implementa una tabla `settlement_failures` que actúa como registro canónico de estos eventos, genera alertas operacionales, y establece la base para una política de crédito futura.

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | S6-01 |
| **Tipo** | feature |
| **SDD_MODE** | full |
| **Objetivo** | Registrar todo caso "cobro sin servicio" en tabla dedicada + alerta automática |
| **Reglas de negocio** | Un settlement exitoso + upstream failure = settlement_failure SIEMPRE. No silencioso. |
| **Scope IN** | Tabla `settlement_failures`, insert en invoke/route.ts Route B, alerta en admin status |
| **Scope OUT** | Refund on-chain, crédito automático al usuario, UI de reclamaciones, Path A (agent key) |
| **Missing Inputs** | N/A |

### Acceptance Criteria (EARS)

1. WHEN `settlement.verified = true AND settlement.settled = true AND result.status != 'success'`, THE system SHALL insert a row in `settlement_failures` with `settlement_tx_hash`, `agent_slug`, `amount_usdc`, `caller_wallet`, `error_reason`, `created_at`.
2. WHEN `settlement_failures` has any row with `resolved_at IS NULL`, THE `/api/admin/status` endpoint SHALL include `settlement_failures_pending: N` in its response.
3. WHEN insert into `settlement_failures` fails, THE system SHALL log `[invoke] settlement_failure insert failed` as ERROR (non-fatal — never block the response).
4. IF `result.status === 'success'`, THEN THE system SHALL NOT insert into `settlement_failures`.
5. WHILE upstream returns error after settlement, THE `agent_calls` row SHALL still be inserted with `status='error'` as today (backward compatible).

## 3. Context Map

### Archivos leídos

| Archivo | Por qué | Patrón extraído |
|---------|---------|-----------------|
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Flujo post-settlement, dónde insertar | Route B: línea 446 `logCall` → insertar `settlement_failure` justo antes si `result.status !== 'success'` |
| `src/app/api/admin/status/route.ts` | Dónde agregar el contador | Seguir patrón de consultas existentes |
| `supabase/migrations/058_performance_score.sql` | Patrón de migración | `ALTER TABLE` con `IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` |

### Exemplars

| Para crear/modificar | Seguir patrón de | Razón |
|---------------------|------------------|-------|
| `059_settlement_failures.sql` | `058_performance_score.sql` | Patrón de migración con comentario de contexto |
| Insert en invoke/route.ts | `increment_pending_earnings` fire-and-forget (línea ~463) | Non-fatal, no bloquea TTFB |

### Estado de BD

| Tabla | Existe | Columnas relevantes |
|-------|--------|---------------------|
| `agent_calls` | Sí | `status`, `settlement_tx_hash`, `agent_slug`, `caller_wallet`, `amount_paid` |
| `settlement_failures` | **No** | A crear |

### Componentes reutilizables

- `logger.error` en `src/lib/logger.ts` — usar para log de fallo de insert
- Pattern fire-and-forget con `.catch` en invoke/route.ts línea ~463

## 4. Diseño Técnico

### 4.1 Archivos a crear/modificar

| Archivo | Acción | Descripción | Exemplar |
|---------|--------|-------------|----------|
| `supabase/migrations/059_settlement_failures.sql` | Crear | Tabla `settlement_failures` | `058_performance_score.sql` |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Modificar | Insert non-fatal post-settlement failure | fire-and-forget pattern línea ~463 |
| `src/app/api/admin/status/route.ts` | Modificar | Añadir `settlement_failures_pending` | consultas existentes en el mismo archivo |

### 4.2 Modelo de datos

```sql
CREATE TABLE IF NOT EXISTS settlement_failures (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_tx_hash  TEXT NOT NULL,          -- tx del USDC transfer
  agent_slug          TEXT NOT NULL,
  amount_usdc         NUMERIC(10,6) NOT NULL, -- lo que se cobró
  caller_wallet       TEXT,                   -- de agent_calls.caller_wallet (nullable en Route B)
  error_reason        TEXT,                   -- upstream error truncado a 500 chars
  agent_call_id       UUID,                   -- FK a agent_calls.id (del return de logCall)
  resolved_at         TIMESTAMPTZ,            -- NULL = pendiente, !NULL = resuelto
  resolution_note     TEXT,                   -- cómo se resolvió (crédito, refund, etc.)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlement_failures_pending
  ON settlement_failures (created_at)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_settlement_failures_tx
  ON settlement_failures (settlement_tx_hash);
```

### 4.3 Flujo principal (Happy Path — el triste)

1. Route B: settlement exitoso (`settlement.verified = true`, `settlement.settled = true`)
2. `callUpstream()` retorna `result.status !== 'success'`
3. `logCall()` inserta en `agent_calls` con `status='error'` — capturar `{ id: callId }` del return
4. Fire-and-forget: insert en `settlement_failures` con:
   - `settlement_tx_hash = settlement.transactionHash` (campo `transactionHash` de `SettlementResult`)
   - `agent_slug`, `amount_usdc = model.price_per_call`
   - `caller_wallet` = null (Route B no tiene wallet en scope actual)
   - `agent_call_id = callId` del return de logCall
5. Response: 502 al caller (sin cambios)

### 4.4 Flujo de error (insert falla)

1. Insert en `settlement_failures` lanza excepción
2. `logger.error('[invoke] settlement_failure insert failed', { err, txHash })`
3. Continúa — no bloquea response al cliente

### 4.5 Admin status

`GET /api/admin/status` añade:
```json
{
  "settlement_failures_pending": 2
}
```
Query: `SELECT COUNT(*) FROM settlement_failures WHERE resolved_at IS NULL`

## 5. Constraint Directives

### OBLIGATORIO seguir
- Insert fire-and-forget: `void Promise.resolve(...).catch(err => logger.error(...))`
- No bloquear TTFB bajo ninguna circunstancia
- `error_reason`: truncar a 500 chars antes de insertar
- Migración con `CREATE TABLE IF NOT EXISTS` y `CREATE INDEX IF NOT EXISTS`

### PROHIBIDO
- NO modificar el flujo de Route A (agent key)
- NO lanzar excepciones desde el bloque de insert a `settlement_failures`
- NO añadir campos a `agent_calls` en esta HU
- NO implementar refund ni crédito (fuera de scope)
- NO modificar `logCall()` — el insert de `settlement_failures` va DESPUÉS de `logCall()`

## 6. Scope

**IN:**
- Tabla `settlement_failures` (migración 059)
- Insert post-settlement-failure en Route B
- Contador `settlement_failures_pending` en `/api/admin/status`

**OUT:**
- UI de settlement failures
- Refund automático
- Crédito al usuario
- Route A (agent key path)
- Email/notificación al usuario

## 7. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Insert falla y silencia el error real | B | M | fire-and-forget con catch explícito |
| `caller_wallet` null (no siempre disponible) | A | B | Columna nullable |
| `agent_call_id` race condition | B | B | Nullable — tomar de logCall return |

## 8. Dependencias

- Ninguna nueva. Supabase service client ya existe.

---

*SDD generado por NexusAgil — FULL | Sprint 6*
