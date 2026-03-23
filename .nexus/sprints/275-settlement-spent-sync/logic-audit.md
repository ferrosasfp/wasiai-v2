# Logic Audit — WAS-275: sync_key_after_settlement
**Auditor:** Logic Auditor subagent  
**Commit:** `6872b0308`  
**Fecha:** 2026-03-22  
**Veredicto final:** ✅ SIN BLOQUEANTES — 2 hallazgos MENOR

---

## Trazabilidad AC → Código

| AC | Descripción | Implementado en | Estado |
|----|-------------|-----------------|--------|
| AC-1 | spent_usdc reducido por SUM(amount_paid) de batchCallIds | `075_sync_key_after_settlement.sql` líneas 21-24 + UPDATE línea 36 | ✅ OK |
| AC-2 | Postcondition: spent_usdc_new = spent_usdc_old - settled_amount | UPDATE atómico `spent_usdc = GREATEST(0, spent_usdc - v_settled_amount)` | ✅ OK |
| AC-3 | Partial settlement solo reduce por lo realmente liquidado | SUM filtra únicamente los `p_call_ids` pasados | ✅ OK |
| AC-4 | Si sync falla, spent_usdc NO se modifica | try/catch en route.ts línea ~215; DB usa transacción implícita del RPC | ✅ OK |
| AC-5 | No idempotente, caller guards | RPC no verifica settled_at; settled_at se escribe antes del RPC en route.ts | ✅ OK (by design) |
| AC-6 | deduct_key_balance e increment_key_budget NO modificados | migration 017 sin cambios; 045 (refund) tampoco tocado | ✅ OK |
| AC-7 | Firma: p_key_id UUID, p_call_ids UUID[], p_new_budget NUMERIC, computa internamente | Firma correcta; v_settled_amount calculado internamente | ✅ OK |
| AC-8 | budget_usdc SET y spent_usdc reducido en mismo UPDATE | Un solo UPDATE statement líneas 34-39 | ✅ OK |
| AC-9 | spent_usdc >= 0, GREATEST(0,...), RAISE WARNING al clampear | `GREATEST(0, spent_usdc - v_settled_amount)` + `RAISE WARNING` | ✅ OK |
| AC-10 | Patrón REVOKE/GRANT | Líneas 55-56 del SQL | ✅ OK |
| AC-11 | balance_synced_at = now() en mismo UPDATE | `balance_synced_at = now()` en el UPDATE | ✅ OK |

---

## Hallazgos

### MENOR-1: TOCTOU en WARNING de clamping
**Archivo:** `075_sync_key_after_settlement.sql` líneas 26-30  
**Descripción:** La lógica de advertencia usa `v_old_spent` (capturado en un SELECT separado), pero el UPDATE usa `spent_usdc` en vivo. Si otra transacción modifica `spent_usdc` entre el SELECT y el UPDATE, el WARNING podría dispararse incorrectamente (falso positivo o falso negativo). El UPDATE en sí es correcto y atómico — solo el diagnóstico puede ser impreciso.  
**Impacto:** Bajo. Solo afecta logs de clamping, no la integridad de datos.  
**Recomendación:** Aceptable tal como está. Si se desea precisión total, calcular el WARNING dentro del UPDATE usando `RETURNING` o eliminar el pre-fetch y confiar solo en `rows_updated`.

---

### MENOR-2: `p_call_ids` vacío actualiza budget_usdc sin reducir spent_usdc
**Archivo:** `075_sync_key_after_settlement.sql` líneas 21-24  
**Descripción:** Si `p_call_ids = '{}'` (array vacío), `COALESCE(SUM(amount_paid), 0) = 0`. El UPDATE procede sin error: `spent_usdc` no cambia (correcto) pero `budget_usdc = p_new_budget` sí se aplica. Este es un side effect potencialmente intencional (sincronizar presupuesto aunque no hubo calls), pero no está documentado en el SDD.  
**Impacto:** Bajo. El caller (route.ts) siempre pasa `batchCallIds` no vacíos por construcción del loop. No es un path alcanzable en producción con el caller actual.  
**Recomendación:** Documentar el comportamiento o agregar `IF array_length(p_call_ids, 1) IS NULL THEN RETURN; END IF;` para hacer explícita la intención.

---

## Checklist General

| Área | Estado | Notas |
|------|--------|-------|
| Corrección lógica | ✅ | UPDATE atómico correcto; GREATEST correcto |
| Edge cases | ⚠️ MENOR | Array vacío (MENOR-2); key inactiva → rows_updated=0 + WARNING ✓ |
| Concurrencia | ✅ | UPDATE usa live `spent_usdc`, no el valor pre-fetched → no TOCTOU en datos |
| Error handling | ✅ | try/catch en route.ts; rows_updated=0 → WARNING en DB |
| Tipos y casting | ✅ | NUMERIC consistente; UUID correcto |
| Scope creep | ✅ | Sin console.log, sin side effects inesperados, sin código comentado |
| AC-6 (no tocar otros RPCs) | ✅ | deduct_key_balance y refund_key_balance intactos |

---

## Conclusión

El código implementa correctamente los 11 ACs del SDD. La lógica central (cómputo de `v_settled_amount`, UPDATE atómico, GREATEST, REVOKE/GRANT, balance_synced_at) es sólida. Los dos hallazgos son mejoras de calidad, no bugs que comprometan la integridad de datos.

**→ APROBADO. Builder puede continuar al siguiente paso del pipeline.**
