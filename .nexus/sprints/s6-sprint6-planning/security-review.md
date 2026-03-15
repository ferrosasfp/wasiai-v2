# Security Review — Sprint 6
**Reviewer:** NexusAgil Security Bot v1.3  
**Fecha:** 2026-03-14  
**Scope:** settlement_failures table + x402 invoke flow + admin/status endpoint

---

## Checklist

| Check | Resultado | Detalle |
|-------|-----------|---------|
| 1. Info leak en logs | ⚠️ WARN | `settle_result` y `settlement_failure recorded` loguean `txHash` en server logs. `payment_verification_failed` loguea el objeto `settlement` completo. Logs son server-side, no cliente, pero si se shipean a Datadog/Logtail con datos on-chain sensibles merece revisión. |
| 2. settlement_failures RLS | 🔴 FAIL | **Sin RLS configurado.** Tabla contiene `settlement_tx_hash`, `amount_usdc`, `caller_wallet`. Accesible vía PostgREST con rol `anon` si el project tiene PostgREST habilitado. |
| 3. admin/status auth | 🟡 MEDIUM | Endpoint sin autenticación server-side. El comentario dice "el panel verifica ownership en cliente con wallet" — eso NO protege la ruta API. Cualquiera puede hacer `GET /api/admin/status` y ver datos operativos (`failures_pending`, `x402_health`, `avaxBalance`). |
| 4. NaN guard `min_performance` | ⚠️ WARN | `Number("  80  ")` → 80, correcto ✅. `Number("")` → 0 → **pasa el guard** y se aplica `gte('performance_score', 0)`, equivalente a casi sin filtro. Una query `?min_performance=` vacío debería rechazarse o ignorarse, no tratarse como 0. |
| 5. SQL injection en migración | ✅ PASS | DDL puro, sin concatenación de strings. Sin riesgo. |
| 6. settlement_tx_hash undefined | ✅ PASS con nota | Código usa `settlement.transactionHash ?? 'unknown'` — el insert no falla. Pero registrar `'unknown'` como tx_hash es ruido en la tabla de auditoría financiera; sería mejor omitir el insert si no hay hash real. |
| 7. error_reason truncado | ✅ PASS con nota | Se trunca a 500 chars: `.slice(0, 500)` ✅. Sin embargo, `result.data` es el body del upstream y podría contener datos del usuario reflejados. Sin RLS (ver #2), este campo quedaría expuesto públicamente. |

---

## Findings

| # | Severidad | Descripción | Fix requerido |
|---|-----------|-------------|---------------|
| F-01 | 🔴 HIGH | **No RLS en `settlement_failures`**: tabla financiera accesible por rol `anon` via PostgREST. Expone `settlement_tx_hash`, `amount_usdc`, `caller_wallet`, `error_reason`. | Añadir al final de `059_settlement_failures.sql`: `ALTER TABLE settlement_failures ENABLE ROW LEVEL SECURITY;` + policy de solo lectura para `service_role`. Bloquear acceso `anon` y `authenticated` hasta definir política explícita. |
| F-02 | 🟡 MEDIUM | **`/api/admin/status` sin autenticación server-side**: cualquier actor externo puede consultar contadores de failures, balance AVAX del operador y estado del settlement. Es inteligencia operativa que facilita timing attacks. | Añadir guard antes del handler: verificar `Authorization` header con un `ADMIN_API_SECRET` env var, o migrar a una ruta protegida por Supabase Auth con rol admin. |
| F-03 | 🟡 MEDIUM | **Log completo del objeto `settlement` en fallo de verificación**: `logger.error('[invoke] payment verification failed', settlement)` serializa el objeto `SettlementResult` completo, que puede incluir `transactionHash` y campos del payload EVM. Si los logs van a un servicio externo (Logtail, Datadog), esto expone datos on-chain. | Reemplazar por: `logger.error('[invoke] payment verification failed', { verified: settlement.verified, error: settlement.error })`. |
| F-04 | 🔵 LOW | **NaN guard: `Number("") → 0` pasa validación**: `?min_performance=` (vacío) se trata como 0 en lugar de ser ignorado o rechazado. Behavior no intencional, crea confusión en clients A2A. | Añadir check: `if (minPerfRaw.trim() === '') { /* ignorar */ }` antes del `Number(minPerfRaw)`. Alternativamente, rechazar con 400 si el valor es blank. |
| F-05 | ⚪ INFO | **`settlement_tx_hash = 'unknown'` como fallback**: insertar `'unknown'` en una columna de auditoría financiera es ruido. Si `transactionHash` es undefined en un settled=true context, es un estado inconsistente que merece alerta, no silencio. | Considerar: si `!settlement.transactionHash`, loguear `ERROR` y no insertar en `settlement_failures` (o insertar con valor NULL si la columna se cambia a nullable). |
| F-06 | ⚪ INFO | **`error_reason` puede contener datos del usuario**: sin RLS (F-01), el campo `error_reason` con hasta 500 chars del upstream response body queda expuesto públicamente. No es un finding independiente pero amplifica F-01. | Resuelto junto con F-01 (RLS). |

---

## Fix prioritario para F-01 (RLS)

```sql
-- Añadir al final de 059_settlement_failures.sql
-- o en una nueva migración 060_settlement_failures_rls.sql

ALTER TABLE settlement_failures ENABLE ROW LEVEL SECURITY;

-- Solo service_role puede leer/escribir (admins via Supabase dashboard)
-- anon y authenticated no tienen acceso

-- Si se necesita acceso autenticado para admins en el futuro:
-- CREATE POLICY "admin_read" ON settlement_failures
--   FOR SELECT USING (auth.jwt() ->> 'role' = 'admin');
```

---

## Fix prioritario para F-02 (admin/status auth)

```typescript
// src/app/api/admin/status/route.ts — añadir al inicio del GET handler
export async function GET(request: Request) {
  const adminSecret = process.env.ADMIN_API_SECRET
  if (adminSecret) {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${adminSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  // ... resto del handler
}
```

---

## Veredicto: ❌ FAIL

**Razón principal:** F-01 (sin RLS en tabla financiera) es un riesgo inaceptable para producción. Una tabla con `settlement_tx_hash`, `amount_usdc` y potencial `caller_wallet` accesible sin restricciones via PostgREST puede comprometer la privacidad financiera de los usuarios y exponer inteligencia sobre volumen de fallos.

**Condición para PASS:** Resolver F-01 y F-02 antes de mergear a `main`. F-03 y F-04 pueden ir en el mismo PR como hardening adicional.

**Items F-05/F-06:** No bloqueantes, pueden atenderse en Sprint 7.
