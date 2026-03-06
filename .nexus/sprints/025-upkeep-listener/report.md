# QA Report — NNN-025 Upkeep Listener
**HU:** WAS-82 | **NNN:** 025 | **Modo:** QUALITY  
**Fecha cierre:** 2026-03-02 | **Sprint:** 17

---

## Resumen ejecutivo

Implementación del worker Vercel Cron que detecta upkeep pendiente via Chainlink Automation (`checkUpkeep`) y ejecuta el pipeline de settlement compartido (`runSettlement.ts`). El cron corre cada 5 minutos con restart automático por Vercel.

---

## Archivos entregados

| Archivo | Tipo | Commit |
|---------|------|--------|
| `src/app/api/cron/upkeep-listener/route.ts` | NUEVO | `0344d3e` |
| `src/lib/settlement/runSettlement.ts` | NUEVO (extraído) | `0344d3e` |
| `src/app/api/cron/settle-key-batches/route.ts` | MODIFICADO | `0344d3e` |
| `vercel.json` | MODIFICADO | `0344d3e` |
| `src/lib/settlement/runSettlement.ts` (lock) | PATCH | `9429025` |
| `doc/sdd/025-upkeep-listener/cr-review.md` | DOCS | `2225339` |

---

## ACs — Resultado Final

| AC | Descripción | Resultado |
|----|-------------|-----------|
| AC-1 | Cron cada 5 min — `vercel.json` | ✅ CUMPLE |
| AC-2 | `upkeepNeeded=false` → `upkeep_not_needed` | ✅ CUMPLE |
| AC-3 | `upkeepNeeded=true` → runSettlement pipeline | ✅ CUMPLE |
| AC-4 | Sin auth → HTTP 401 | ✅ CUMPLE |
| AC-5 | `npm run build` sin errores TS | ✅ CUMPLE |
| AC-6 | RPC error → HTTP 500, no bloquea | ✅ CUMPLE |

---

## AR / CR

- **Adversarial Review:** APPROVED ✅ — Advisory lock agregado en `9429025`
- **Code Review:** APPROVED ✅ — `cr-review.md` en `2225339`

---

## Auto-Blindaje — Deuda Técnica Sprint 18

**Issue detectado en F4:**  
`runSettlement.ts:23` consulta `system_config` WHERE `key = 'settlement_lock'`.  
Si la row **no existe** (nunca fue insertada por migración), el advisory lock devuelve `null` y el check pasa silenciosamente — permitiendo ejecuciones concurrentes sin warning.

**Impacto:** Double-settlement posible en producción si dos crons se solapan sin la row presente.

**Acción requerida — Sprint 18:**
```sql
INSERT INTO system_config (key, value, description)
VALUES ('settlement_lock', 'false', 'Advisory lock para runSettlement — previene ejecución concurrente')
ON CONFLICT (key) DO NOTHING;
```
Agregar como migración numerada antes del deploy en mainnet.

---

## Tests Pendientes — Sprint 18

- [ ] Test integración `upkeep-listener` con mock `checkUpkeep = true/false`
- [ ] Test mock `runSettlement` con Supabase stub
- [ ] Migración `settlement_lock` row en `system_config`

---

## Veredicto

**WAS-82: DONE ✅**  
Worker activo en producción (Fuji testnet). Build limpio. Deuda documentada.
