# Adversarial Review — NNN-025 / WAS-82
**Reviewer:** Adversary (NexusAgil)  
**Commit:** `0344d3e`  
**HU:** WAS-82 — Listener UpkeepPerformed → settlement automático  
**Fecha:** 2026-03-02  
**Modo:** QUALITY

---

## Tabla de Hallazgos

| # | Categoría | Veredicto | Hallazgo |
|---|-----------|-----------|----------|
| 1 | Seguridad auth | ✅ OK | `upkeep-listener` verifica `CRON_SECRET` correctamente antes de cualquier lógica. También valida que el secret no sea vacío (devuelve 500 si no está configurado), comportamiento idéntico a `settle-key-batches`. |
| 2 | Doble ejecución | 🔴 BLOQUEANTE | Ambos crons pueden ejecutar `runSettlement` simultáneamente. La función lee `settled_at IS NULL` y luego hace `UPDATE settled_at`. Sin lock/mutex a nivel DB (e.g., SELECT FOR UPDATE o advisory lock), si ambos crons leen el mismo conjunto de calls antes de que alguno complete el UPDATE, puede ocurrir doble on-chain settlement de las mismas calls. Con pagos reales en producción esto es crítico. |
| 3 | Regression settle-key-batches | ⚠️ MENOR | La lógica es funcionalmente idéntica. Sin embargo, la respuesta JSON cambió: el campo `keys` era `byKey.size` (total de key_ids agrupados) y ahora es `results.length` (solo keys que generaron un entry en results). Las keys con `allValidCalls.length === 0` hacen `continue` sin push a `results`, por lo que `keys` puede ser menor al anterior. Si hay monitoreo/alertas que dependen de este valor, puede generar falsos positivos. |
| 4 | checkUpkeep error handling | ✅ OK | Si el RPC falla, el error es capturado en try/catch, se loguea y devuelve HTTP 500 con detalle. El proceso no continúa al settlement. Comportamiento correcto. |
| 5 | vercel.json límite de crons | ✅ OK | Exactamente 2 crons: `settle-key-batches` a las `0 2 * * *` y `upkeep-listener` a `*/5 * * * *`. Correctamente configurados. |
| 6 | Scope drift | ✅ OK | Solo se modificaron/crearon archivos dentro del scope IN: `settle-key-batches/route.ts`, `upkeep-listener/route.ts` (nuevo), `runSettlement.ts` (nuevo), `vercel.json`. Sin modificaciones fuera de scope. |
| 7 | Constraint Directives | ✅ OK | `runSettlement.ts` no contiene auth (`CRON_SECRET`) ni `settlement_mode` check — correctamente delegado al caller. `performUpkeep` no se invoca desde ningún cron — solo `checkUpkeep` (view function, sin gas). |
| 8 | TypeScript / build | ✅ OK | `tsc --noEmit` ejecutado sin errores ni warnings. |

---

## Detalle del Hallazgo BLOQUEANTE

### 🔴 #2 — Race condition doble settlement

**Escenario:**
1. Cron A (`upkeep-listener`, cada 5 min) y Cron B (`settle-key-batches`, 02:00 UTC) se ejecutan simultáneamente (o con overlap mínimo).
2. Ambos llaman `runSettlement(supabase)`.
3. Ambos ejecutan el SELECT: `settled_at IS NULL` → obtienen el mismo conjunto de calls no liquidadas.
4. Ambos proceden a llamar `settleKeyBatchOnChain(...)` con los mismos datos.
5. Ambos hacen `UPDATE agent_calls SET settled_at = now` → doble on-chain transaction.

**Impacto:** Pagos duplicados a creadores en blockchain. Con USDC real en producción, esto es una pérdida financiera directa.

**Corrección requerida (opciones):**
- **Opción A (recomendada):** Usar un Supabase advisory lock (`pg_try_advisory_xact_lock`) al inicio de `runSettlement` para garantizar ejecución serial.
- **Opción B:** Añadir un flag de "processing" en DB (e.g., tabla `settlement_locks` con TTL) que cada cron verifique antes de ejecutar.
- **Opción C:** Asegurar que los 2 crons nunca puedan solaparse en tiempo (horario + duración máxima), pero esto es frágil y no garantizable.

---

## Detalle del Hallazgo MENOR

### ⚠️ #3 — `keys` en response JSON (regresión silenciosa)

**Antes:** `keys: byKey.size` → número total de key_ids con calls no liquidadas agrupadas.  
**Ahora:** `keys: results.length` → número de keys que generaron un entry en el array `results`.

**Diferencia:** Keys con `allValidCalls.length === 0` (todas con `amount_paid = 0` o `agent_slug = null`) hacen `continue` sin push → no cuentan en `results.length` pero sí contaban en `byKey.size`.

**Impacto:** Bajo (solo métricas/logs). No afecta correctness funcional. Se recomienda corregir para consistencia de observabilidad.

**Corrección sugerida:** En `runSettlement`, retornar también `totalKeys: byKey.size` y usar ese valor en el response de ambos routes.

---

## Veredicto

```
🔴 CHANGES_REQUESTED
```

**Bloqueante:** 1 (doble ejecución / race condition on-chain)  
**Menores:** 1 (keys metric regression)  

El hallazgo #2 debe ser corregido antes de merge a producción. El riesgo de doble payment on-chain con fondos reales no es aceptable.

---

*Generado por NexusAgil Adversary · WasiAI v2 QUALITY Mode*
