# Validation Report — NNN-027 WasiEscrow (WAS-72)

**Fase:** F4 — QA / Validación  
**Commit:** `52d5ae8`  
**AR:** APPROVED ✅ | **CR:** APPROVED ✅  
**Fecha:** 2026-03-02  
**QA:** San (NexusAgil)

---

## 1. Drift Detection

Archivos modificados en commit `52d5ae8` — todos dentro del Scope IN:

| Archivo | Scope |
|---------|-------|
| `contracts/src/WasiEscrow.sol` | ✅ IN — contrato principal |
| `contracts/test/WasiEscrow.t.sol` | ✅ IN — tests forge |
| `contracts/out/*` | ✅ IN — artefactos compilados |
| `supabase/migrations/034_escrow.sql` | ✅ IN — migración DB |
| `src/app/api/v1/agents/[slug]/invoke-long/route.ts` | ✅ IN — endpoint backend |
| `src/app/api/v1/escrow/[escrowId]/status/route.ts` | ✅ IN — endpoint status |
| `src/app/api/v1/internal/escrow/release-expired/route.ts` | ✅ IN — cron endpoint |
| `src/features/agents/components/EscrowInfoBanner.tsx` | ✅ IN — componente UI |
| `src/app/[locale]/models/[slug]/page.tsx` | ✅ IN — página modelo |
| `src/lib/contracts/escrow.ts` | ✅ IN — cliente contrato |
| `src/features/models/types/models.types.ts` | ✅ IN — tipos |
| `src/features/publish/components/PublishPreview.tsx` | ✅ IN — publicación |

**Veredicto Drift:** ✅ SIN DRIFT — 17 archivos, todos dentro del Scope IN.

---

## 2. Verificación de ACs

| AC | Descripción | Evidencia | Estado |
|----|-------------|-----------|--------|
| AC-1 | `agents.long_running` existe en migración 034 | `supabase/migrations/034_escrow.sql:6` — `ALTER TABLE agents ADD COLUMN IF NOT EXISTS long_running BOOLEAN NOT NULL DEFAULT false;` | ✅ CUMPLE |
| AC-2 | `WasiEscrow.createEscrow` existe y usa ERC-3009 | `contracts/src/WasiEscrow.sol:94` — `function createEscrow(...)` con `receiveWithAuthorization` (IERC3009) | ✅ CUMPLE |
| AC-3 | `WasiEscrow.releaseEscrow` existe con onlyOperator | `contracts/src/WasiEscrow.sol:132-134` — `function releaseEscrow(...) onlyOperator` | ✅ CUMPLE |
| AC-4 | `WasiEscrow.releaseExpired` requiere 24h | `contracts/src/WasiEscrow.sol:48` — `RELEASE_TIMEOUT = 24 hours`; `contracts/src/WasiEscrow.sol:146,153` — enforced en `releaseExpired` | ✅ CUMPLE |
| AC-5 | `WasiEscrow.refundEscrow` existe con onlyOperator | `contracts/src/WasiEscrow.sol:162-164` — `function refundEscrow(...) onlyOperator` | ✅ CUMPLE |
| AC-6 | forge test WasiEscrow: todos pasan | 10/10 tests PASS — `test_CreateEscrow_HappyPath`, `test_ReleaseExpired_After24h`, etc. Suite completa: 148 tests passed, 0 failed | ✅ CUMPLE |
| AC-7 | EscrowInfoBanner existe y muestra si long_running | `src/app/[locale]/models/[slug]/page.tsx:11,200` — importado y renderizado con `{model.long_running && <EscrowInfoBanner />}` | ✅ CUMPLE |
| AC-8 | `invoke-long` endpoint existe y retorna escrow_id | `src/app/api/v1/agents/[slug]/invoke-long/route.ts:154,181` — responde con `escrow_id` en 202 | ✅ CUMPLE |

**Resultado:** 8/8 ACs ✅ — TODOS CUMPLEN

---

## 3. Build

```
npm run build → Process exited with code 0 ✅
forge test    → 148 tests passed, 0 failed ✅
```

---

## Veredicto Final

**APPROVED ✅ — WAS-72 listo para DONE**
