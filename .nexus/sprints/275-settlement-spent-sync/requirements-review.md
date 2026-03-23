# Requirements Review — WAS-275

> Reviewer: Requirements Reviewer (subagent)
> Fecha: 2026-03-22
> Work Item: /home/ferdev/.openclaw/workspace/wasiai-v2/.nexus/sprints/275-settlement-spent-sync/work-item.md

---

## Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| F1 | AC incompleto | 🔴 Alta | **AC-5 es incorrecto en escenarios reales.** "WHEN zero unsettled calls after settlement, THEN spent_usdc SHALL be 0" — pero el route tiene `.limit(500)`, hay calls con slugs no registrados, y calls trimmeados que quedan sin liquidar. Si hay calls pendientes fuera del batch actual, poner spent_usdc=0 causaría underspend: el usuario gastaría de saldo ya consumido. | Ver AC-S1 |
| F2 | AC vago/no-testeable | 🔴 Alta | **AC-2 no es una aserción concreta.** "budget_usdc - spent_usdc SHALL equal on-chain getKeyBalance minus unsettled pending calls" — esto es una invariante derivada, no una precondición/postcondición testeable. No especifica qué se mide, cuándo, ni qué tolerancia numérica. | Ver AC-S2 |
| F3 | Path no cubierto | 🔴 Alta | **Idempotencia ausente.** Si settlement falla a medias (settled_at marcado en calls, pero el RPC sync_key no se ejecutó por crash), la segunda ejecución reintentará. No hay AC que prevenga que spent_usdc se reduzca dos veces para los mismos calls. Las calls ya tienen `settled_at IS NOT NULL` al reintento, así que el re-fetch de pendingCalls no las incluiría — pero esto no está explícito. | Ver AC-S3 |
| F4 | AC ambiguo | 🟠 Media | **AC-7 dice "atomic" pero no delimita qué operaciones están adentro.** El código hace: (1) mark settled_at, (2) update budget_usdc, (3) [nuevo] reduce spent_usdc — en tres round-trips separados. ¿El AC garantiza que las tres son atómicas? ¿O solo (2)+(3)? Si el proceso muere entre (1) y (3), spent_usdc queda desfasado. | Aclarar scope de la atomicidad en AC-7 |
| F5 | Edge case faltante | 🟠 Media | **Overflow del límite de 500 calls.** El route tiene `.limit(500)` hardcodeado. Si hay >500 pending calls para una key, solo se liquidan las primeras 500 pero spent_usdc quedaría reducido solo por esas 500. No hay AC que documente este comportamiento esperado ni que alerte si se trunca el batch. | Ver AC-S4 |
| F6 | Dependencia implícita | 🟠 Media | **El RPC sync_key_after_settlement necesita recibir call_ids o settled_amount como parámetros.** AC-3 dice "solo reducir por lo realmente liquidado" pero no especifica la interfaz del RPC (¿recibe `p_settled_amount NUMERIC`? ¿`p_call_ids UUID[]`?). Decisión crítica: si recibe amount pre-calculado en TS, hay race condition; si lo calcula en SQL con los IDs, es seguro. El AC debe fijar esta decisión. | Ver AC-S5 |
| F7 | Riesgo sin AC | 🟠 Media | **R1 (spent_usdc negativo) mencionado en Riesgos pero sin AC formal.** "GREATEST(0, ...)" está en Riesgos pero no hay AC que diga explícitamente que spent_usdc NUNCA puede quedar < 0 post-sync. | Ver AC-S6 |
| F8 | Patrón de seguridad | 🟡 Baja | **El nuevo RPC debe seguir el patrón REVOKE/GRANT de refund_key_balance (migration 045).** No está mencionado en ACs ni en "Archivos afectados". Si el RPC queda con EXECUTE público, es un vector de manipulación de contabilidad. | Mencionar en ACs o en sección de Riesgos |
| F9 | Código conflictante | 🟡 Baja | **El post-settlement sync actual (WAS-218) hace `budget_usdc = postSettleBalance` con SET, no sumatorio.** El nuevo fix debe coexistir: se mantiene ese SET pero se agrega la reducción de spent_usdc. AC-6 dice "no modificar deduct_key_balance" ✅, pero no dice nada sobre si el SET de budget_usdc se mantiene, se modifica, o se mueve dentro del RPC. | Aclarar en AC-6 o AC-7 |
| F10 | Número de migración | 🟡 Baja | **Work item dice "nueva migración" sin especificar número.** La última migración es 045_refund_key_balance.sql. El equipo debería reservar 046 explícitamente para evitar conflictos en branches paralelas. | Agregar a "Archivos afectados" |

---

## ACs sugeridos (agregar)

```markdown
- **AC-S1:** WHEN a settlement batch completes for a key, THEN `spent_usdc` SHALL be reduced
  by exactly SUM(amount_paid) of the calls included in `batchCallIds` — NOT by
  calls outside the batch (unregistered, trimmed, or beyond the 500-call limit).

- **AC-S2:** WHEN the sync RPC executes, THEN the postcondition testeable es:
  `spent_usdc_new = spent_usdc_old - settled_amount` donde `settled_amount =
  SUM(amount_paid) FOR call_ids IN batchCallIds`. Tolerancia: 0 (debe ser exacto,
  NUMERIC con misma precisión que amount_paid).

- **AC-S3:** WHEN `sync_key_after_settlement` is called with call_ids that already have
  `settled_at IS NOT NULL` (retry scenario), THEN the RPC SHALL be idempotent —
  it SHALL NOT reduce spent_usdc a second time for the same calls.
  (Implementación sugerida: el RPC calcula settled_amount solo de calls
  WHERE id IN (p_call_ids) AND settled_at IS NOT NULL para garantizar esto.)

- **AC-S4:** WHEN the pending calls batch is truncated at the 500-call limit and not all
  pending calls for a key are settled, THEN the post-settlement spent_usdc reduction
  SHALL only account for the calls actually in the batch — the remaining pending
  calls SHALL remain in spent_usdc until their settlement batch runs.

- **AC-S5 (interfaz del RPC):** `sync_key_after_settlement` SHALL accept `p_key_id UUID`
  and `p_call_ids UUID[]` as parameters. It SHALL internally compute
  `settled_amount = SUM(amount_paid) FROM agent_calls WHERE id = ANY(p_call_ids)`.
  The caller (route.ts) SHALL NOT pre-compute the amount in TypeScript to avoid
  TOCTOU race conditions.

- **AC-S6:** AFTER `sync_key_after_settlement` executes, `spent_usdc` for the affected key
  SHALL be >= 0. The RPC SHALL use `GREATEST(0, spent_usdc - settled_amount)` and
  SHALL raise a WARNING (not exception) if the clamping was applied (indicating
  accounting inconsistency for monitoring).
```

---

## Veredicto

**NECESITA CAMBIOS**

Los ACs tienen dos problemas bloqueantes antes de implementar:

1. **AC-5 es incorrecto** — tal como está, si se aplica literalmente haría que un settlement parcial (por limit=500 o slugs sin registrar) zerease incorrectamente spent_usdc de calls aún pendientes.
2. **La interfaz del RPC no está especificada** — sin saber si recibe `p_amount` o `p_call_ids`, el SDD no puede diseñarse correctamente, y la decisión afecta si hay o no race condition.

Los demás hallazgos (F4, F8, F9, F10) son mejoras de calidad que pueden resolverse en el SDD si el equipo los acepta como riesgos conocidos.
