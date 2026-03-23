# Security Review — WAS-275: sync_key_after_settlement

**Reviewer:** Security Reviewer (subagent)  
**Date:** 2026-03-22  
**Sprint:** 275-settlement-spent-sync  
**Archivos revisados:**
- `supabase/migrations/075_sync_key_after_settlement.sql` (NUEVO)
- `src/app/api/admin/settlement/route.ts` (MODIFICADO)
- `supabase/migrations/045_refund_key_balance.sql` (referencia)
- `supabase/migrations/017_pipeline_executions.sql` (referencia)

---

## Veredicto Global: ✅ APROBADO CON OBSERVACIONES

No se detectaron vulnerabilidades CRITICAL ni HIGH. El código sigue los patrones de seguridad establecidos en el proyecto. Hay issues MEDIUM e INFO que se documentan abajo.

---

## Hallazgos

### [MEDIUM] M-01 — `p_new_budget` no es validado contra cero o negativos (SQL)

**Archivo:** `075_sync_key_after_settlement.sql`  
**Línea:** parámetro `p_new_budget NUMERIC`

**Descripción:**  
La función acepta `p_new_budget` sin validación. Si por algún bug en `getKeyBalanceOnChain` retorna `0` o un valor negativo, se escribiría `budget_usdc = 0` en `agent_keys`, dejando la key inutilizable hasta que el usuario recargue.

Un balance de `0` on-chain podría ser legítimo (key recién usada en su totalidad), pero un valor negativo o un `NaN` proveniente de un error de parsing en el caller sería incorrecto.

**Recomendación:**
```sql
IF p_new_budget < 0 THEN
  RAISE EXCEPTION 'p_new_budget must be >= 0, got %', p_new_budget;
END IF;
```

**Explotabilidad:** Requiere que `getKeyBalanceOnChain` retorne un valor anómalo. No es explotable externamente.

---

### [MEDIUM] M-02 — `p_call_ids` vacío silencioso (SQL)

**Archivo:** `075_sync_key_after_settlement.sql`

**Descripción:**  
Si `p_call_ids` llega vacío (`'{}'`), `SUM(amount_paid)` retorna `0` via `COALESCE`, y el UPDATE procede con `spent_usdc` inalterado pero `budget_usdc` sobreescrito con `p_new_budget`. El comportamiento es silencioso — no hay warning ni excepción.

Esto puede ocurrir si el caller pasa `batchCallIds` vacío por un bug de recorte.

**Recomendación:**
```sql
IF array_length(p_call_ids, 1) IS NULL THEN
  RAISE WARNING 'sync_key_after_settlement: empty call_ids for key %', p_key_id;
  RETURN;
END IF;
```

---

### [LOW] L-01 — Double-fetch de balance on-chain introduce race condition leve

**Archivo:** `route.ts`, líneas post-`settleKeyBatchOnChain`

**Descripción:**  
Después de la tx on-chain, se hace un segundo `getKeyBalanceOnChain(keyRow.key_hash)` para obtener `postSettleBalance`. Entre la tx y esta lectura, otro proceso podría modificar el balance on-chain (e.g., otra recarga). El valor que se guarda en `budget_usdc` podría no corresponder exactamente al estado post-settlement.

**Impacto:** `budget_usdc` podría quedar ligeramente desincronizado en escenarios de alta concurrencia. No afecta fondos directamente (es solo el valor mirror del on-chain).

**Recomendación:** Documentar que `budget_usdc` es un "último valor conocido" y no un valor autoritativo, o usar el valor de balance calculado localmente (`keyBalanceUsdc - totalAmount`) como aproximación determinista.

---

### [LOW] L-02 — `sync_key_after_settlement` error es swallowed (non-blocking)

**Archivo:** `route.ts`, bloque `try/catch` del RPC

**Descripción:**  
El error del RPC `sync_key_after_settlement` se captura con `catch` y solo emite un `logger.warn`. La settlement continúa marcando las calls como `settled_at` pero el balance queda desincronizado sin alerta crítica.

**Recomendación:** Considerar métricas/alertas en este path de error, ya que es exactamente el bug que WAS-275 intenta resolver. Un `warn` podría pasar desapercibido.

---

### [INFO] I-01 — SECURITY DEFINER: justificado ✅

La función necesita escribir en `agent_keys` desde un contexto donde el caller (service_role) ya bypasea RLS. El uso es consistente con los patrones en `045` y `017`. Correcto.

---

### [INFO] I-02 — REVOKE/GRANT: correcto ✅

```sql
REVOKE EXECUTE ON FUNCTION sync_key_after_settlement(...) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync_key_after_settlement(...) TO service_role;
```

Sigue exactamente el patrón de `045_refund_key_balance.sql`. Solo `service_role` puede ejecutar.

---

### [INFO] I-03 — SQL injection: sin riesgo ✅

Todos los parámetros son tipados (`UUID`, `UUID[]`, `NUMERIC`). No hay concatenación de strings ni SQL dinámico. Sin riesgo de inyección.

---

### [INFO] I-04 — Ownership no validada en el RPC (por diseño)

La función no verifica que `p_key_id` pertenezca al caller. Esto es correcto porque:
1. Solo `service_role` puede ejecutar (no hay usuarios externos)
2. El caller (route.ts) ya obtuvo `keyId` de la query de `agent_calls` pendientes
3. Es un endpoint admin con auth criptográfica

No es una vulnerabilidad en este contexto.

---

### [INFO] I-05 — Auth del endpoint: correcto ✅

El endpoint valida `verifyAdminSignature` antes de cualquier lógica de negocio. Los headers requeridos (`x-admin-signature`, `x-admin-nonce`, `x-admin-timestamp`) se validan antes de deserializar el body de forma peligrosa. Orden correcto.

---

## Checklist DB Security

| Check | Estado | Notas |
|-------|--------|-------|
| SECURITY DEFINER justificado | ✅ | Mismo patrón que 045/017 |
| REVOKE FROM PUBLIC | ✅ | Presente |
| GRANT solo a service_role | ✅ | Correcto |
| Ownership validada | ✅ | N/A — solo service_role |
| SQL injection | ✅ | Parámetros tipados |
| RLS bypass justificado | ✅ | Acotado a service_role admin |
| Inputs validados | ⚠️ | `p_new_budget` sin guardrail (M-01) |

---

## Resumen de Hallazgos

| ID | Severidad | Descripción | Bloquea deploy |
|----|-----------|-------------|---------------|
| M-01 | MEDIUM | `p_new_budget` sin validación de negativos | No |
| M-02 | MEDIUM | `p_call_ids` vacío no genera error | No |
| L-01 | LOW | Double-fetch balance introduce drift posible | No |
| L-02 | LOW | Error de sync swallowed sin alerta crítica | No |
| I-01~I-05 | INFO | Observaciones positivas | No |

**Ningún hallazgo bloquea el deploy.** Se recomienda aplicar M-01 y M-02 en esta iteración o crear tickets de seguimiento.
