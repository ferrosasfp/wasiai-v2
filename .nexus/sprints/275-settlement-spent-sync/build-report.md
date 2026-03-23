# Build Report — SDD #095

## Wave execution

| Wave | Status | Build | Detalle |
|------|--------|-------|---------|
| Wave 0 (Pre-flight) | ✅ PASS | — | Última migración: 074. Patrón 045 verificado. Bloque route ~204-215 coincide exactamente con SDD. Fix no pre-existente. |
| Wave 1 (Migración SQL) | ✅ PASS | SQL válido | Creado `075_sync_key_after_settlement.sql`: RPC con SECURITY DEFINER, un solo UPDATE atómico, COALESCE(SUM,0), GREATEST(0,...), RAISE WARNING en clamping y 0 rows, REVOKE/GRANT. |
| Wave 2 (Settlement route) | ✅ PASS | `npx tsc --noEmit` → 0 errores | Reemplazado bloque try/catch con llamada a `supabase.rpc('sync_key_after_settlement', {...})` + `if (rpcErr) throw rpcErr`. |

## Commit

- Hash: `6872b0308`
- Message: `fix(settlement): sync spent_usdc post-settlement — WAS-275 SDD #095`
- Files changed: 2

## Discrepancias encontradas

Ninguna. El SDD fue implementado al pie de la letra.

## Notas

- El RPC hace UN solo UPDATE atómico (AC-8 satisfecho).
- `COALESCE(SUM(amount_paid), 0)` protege contra `batchCallIds` vacío (riesgo cubierto).
- La substracción relativa (`spent_usdc - v_settled_amount`) se compone correctamente con `deduct_key_balance` concurrente (no usa SET absoluto).
- `balance_synced_at` se actualiza dentro del RPC — eliminado el UPDATE separado del route.
- NO se modificaron `deduct_key_balance`, `increment_key_budget`, ni `refund_key_balance`.
- NO se hizo git push.
