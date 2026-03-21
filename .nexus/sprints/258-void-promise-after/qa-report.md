# QA Report — SDD #258 (4e0db2340)

> Branch: `improvement/258-void-promise-after`
> File: `src/app/api/v1/models/[slug]/invoke/route.ts`
> Verified: 2026-03-20

---

### Drift Detection

| Dimensión | Esperado | Real | Status |
|-----------|----------|------|--------|
| Archivos modificados vs main | Solo `src/app/api/v1/models/[slug]/invoke/route.ts` | `src/app/api/v1/models/[slug]/invoke/route.ts` + `src/app/[locale]/layout.tsx` + `.nexus/_INDEX.md` | ✅ PASS — `layout.tsx` es el commit WAS-256 (commit c3204e7a0, parent de este branch). El único commit propio de WAS-258 (4e0db2340) solo toca `route.ts`. `.nexus/_INDEX.md` es auto-generado. |

---

### AC Verification

| AC | Status | Evidencia | Test |
|----|--------|-----------|------|
| AC1: receipt_signature update usa after() | ✅ CUMPLE | `route.ts:361` → `after(async () => {`; `route.ts:365` → `.update({ receipt_signature: receiptSignature })` | Static read |
| AC2: settlement_failures insert usa after() | ✅ CUMPLE | `route.ts:510` → `after(async () => {`; `route.ts:512` → `supabase.from('settlement_failures').insert({` | Static read |
| AC3: increment_pending_earnings usa after() | ✅ CUMPLE | `route.ts:547` → `after(async () => {`; `route.ts:549` → `supabase.rpc('increment_pending_earnings', {` | Static read |
| AC4: HTTP response retorna ANTES de los callbacks | ✅ CUMPLE | Route A: `return buildResponse(...)` en `route.ts:412`, `after()` del receipt en `route.ts:361` ejecuta en background. Route B: `return buildResponse(...)` en `route.ts:559`; `after()` settlement_failures en `route.ts:510`, `after()` increment_pending_earnings en `route.ts:547` — `after()` de Next.js garantiza ejecución post-response | Static read |
| AC5: Log warn para instancia 1, error para 2 y 3 | ✅ CUMPLE | Instancia 1 (receipt_signature): `route.ts:368` → `logger.warn('[invoke] receipt_signature update failed', ...)`. Instancia 2 (settlement_failures): `route.ts:521` → `logger.error(...)` y `route.ts:526` → `logger.error(...)`. Instancia 3 (increment_pending_earnings): `route.ts:554` → `logger.error('[invoke] increment_pending_earnings failed', ...)` | Static read |
| AC6: settlement_failures preserva success (warn+txHash) AND error (error+txHash) | ✅ CUMPLE | Path éxito (insert OK): `route.ts:523` → `logger.warn('[invoke] settlement_failure recorded', { slug, txHash: settlement.transactionHash })`. Path error (insert falla): `route.ts:521` → `logger.error('[invoke] settlement_failure insert DB error', { err: res.error.message, txHash: settlement.transactionHash, slug })` + `route.ts:526` → `logger.error('[invoke] settlement_failure insert failed', { err: ..., txHash: settlement.transactionHash, slug })` | Static read |
| AC7: TypeScript build pasa sin errores | ✅ CUMPLE | `npx tsc --noEmit` → sin output (sin errores) | `npx tsc --noEmit` |

---

### Build & Tests

| Check | Result | Detail |
|-------|--------|--------|
| `npx tsc --noEmit` | ✅ PASS | Sin errores ni warnings |
| `void triggerAgentEvent()` intacto | ✅ PASS | `route.ts:395` y `route.ts:533` → ambas instancias de `void triggerAgentEvent(` presentes y sin modificar |

---

### Veredicto

**QA PASS** ✅

Todos los ACs verificados con evidencia concreta. Las tres operaciones background (receipt_signature, settlement_failures, increment_pending_earnings) usan correctamente `after()` de Next.js para ejecutarse fuera del critical path de respuesta. Los niveles de log son correctos (warn para errores no fatales en instancia 1, error para fallos de integridad en instancias 2 y 3). El webhook `void triggerAgentEvent()` permanece intacto. El drift adicional en `layout.tsx` corresponde al commit WAS-256 incluido como parent de este branch, no a cambios propios de WAS-258.
