# QA Report — NNN-027 WasiEscrow (WAS-72)

**Fecha:** 2026-03-02  
**QA:** San (NexusAgil) | **Modo:** QUALITY  
**Commit:** `52d5ae8` | Sprint 17

---

## Resumen Ejecutivo

WAS-72 entrega el sistema completo de escrow on-chain para invocaciones long-running:
contrato ERC-3009, tests forge (10/10 ✅), backend invoke-long, UI banner y migración SQL.
Build limpio, 0 errores. **Aprobado para DONE.**

---

## ACs — Resultado

| AC | Estado |
|----|--------|
| AC-1 `long_running` en migración 034 | ✅ |
| AC-2 `createEscrow` con ERC-3009 | ✅ |
| AC-3 `releaseEscrow` onlyOperator | ✅ |
| AC-4 `releaseExpired` 24h | ✅ |
| AC-5 `refundEscrow` onlyOperator | ✅ |
| AC-6 forge test 10/10 | ✅ |
| AC-7 EscrowInfoBanner | ✅ |
| AC-8 `invoke-long` retorna `escrow_id` | ✅ |

---

## Auto-Blindaje

### 🔴 MENOR H4 (detectado en AR) — Riesgo pre-mainnet

**Hallazgo:** `releaseExpired` libera fondos al marketplace (operador), no al payer.  
Si el operador está caído 24h, el trustless release beneficia al marketplace, no al usuario que pagó.

**Acción requerida Sprint 18 antes de mainnet:**
- Agregar `refundExpired` trustless: si operador no liberó en 24h → fondos vuelven al payer automáticamente
- Considerar separar los flujos: `releaseExpired` → marketplace (éxito tardío), `refundExpired` → payer (fallo)
- Ticket: crear WAS-xx "refundExpired trustless antes de mainnet"

**Severidad:** MENOR en testnet/beta, BLOQUEANTE para mainnet.

---

### 💡 SUGERENCIA CR — Helper `_callEscrow()`

`src/lib/contracts/escrow.ts` tiene repetición de patrón de llamada al contrato.  
Extraer helper `_callEscrow(method, args)` reduciría ~40 líneas y centralizaría manejo de errores on-chain.

**Prioridad:** Baja — refactor cosmético, no funcional.

---

### 💡 SUGERENCIA CR — `estimated_completion` dinámico

`invoke-long` actualmente devuelve `estimated_completion` hardcodeado (constante fija).  
Antes de mainnet: calcular dinámicamente según historial del agente o configuración del modelo.

**Prioridad:** Media — mejora UX para usuarios con expectativas de tiempo.

---

## Métricas

- **Archivos nuevos:** 17 (0 drift)
- **Líneas agregadas:** 1,057
- **Tests forge:** 148 total / 10 WasiEscrow — 0 fallas
- **Build:** 0 errores, 0 warnings bloqueantes

---

## Decisión QA

**✅ DONE — WAS-72 cerrado. Auto-Blindaje registrado para Sprint 18.**
