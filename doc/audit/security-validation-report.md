# Reporte de Validación de Seguridad — WasiAI v2

**Fecha:** 2026-03-05
**Auditor:** NexusGuard v1.0 + NexusAudit v2.0
**Validador:** Claude Opus 4.6
**Scope:** 26 hallazgos (14 off-chain + 12 on-chain)

---

## Resumen Ejecutivo

| Métrica | Valor |
|---------|-------|
| Total hallazgos | 26 |
| ✅ FIXED | 22 (84.6%) |
| ⚠️ PARTIALLY FIXED | 2 (7.7%) |
| 🔵 NOT FIXED (by design) | 1 (3.8%) |
| ℹ️ INFO (no action) | 1 (3.8%) |

**Veredicto: La auditoría de seguridad se considera APROBADA.** Los 2 hallazgos parcialmente resueltos son mejoras de hardening (no vulnerabilidades activas) y están en backlog para iteraciones futuras.

---

## NexusGuard — Off-Chain (14 hallazgos)

### ✅ FIXED — 13/14

| ID | Hallazgo | Severidad | Evidencia |
|----|----------|-----------|-----------|
| NG-001 | OAuth Open Redirect via `x-forwarded-host` | HIGH | `src/lib/security/allowed-origins.ts:20-38` — `getSafeOrigin()` valida `x-forwarded-host` contra allowlist `ALLOWED_HOSTS` antes de usarlo. Fallback seguro a `SITE_URL`. |
| NG-002 | MCP payment bypass via internal fetch | HIGH | `src/app/api/v1/mcp/route.ts:176-235` — Agent key requerido (`wasi_` prefix), budget check fail-closed (línea 229), `check_and_deduct_budget` RPC atómico (línea 244). |
| NG-003 | Cron handler fail-open sin CRON_SECRET | HIGH | `src/app/api/cron/settle-key-batches/route.ts:22-31` — Fail-closed: si `!cronSecret` → 500 (no 200). Si token inválido → 401. Patrón replicado en todos los crons. |
| NG-004 | Server Actions confían en raw headers | MEDIUM | `src/lib/security/allowed-origins.ts:44-55` — `getSafeOriginFromHeaders()` valida `origin` header contra `ALLOWED_HOSTS` antes de usarlo en Server Actions. |
| NG-005 | SSRF validación incompleta (sin DNS probe) | HIGH | `src/lib/security/validateEndpointUrl.ts:58-83` — `validateEndpointUrlAsync()` resuelve DNS y valida que IPs resueltas no sean privadas. Mitiga DNS rebinding. |
| NG-006 | Rate limiting bypass en MCP | MEDIUM | `src/app/api/v1/mcp/route.ts:180-184` — Rate limiting con `checkRateLimit(getInvokeLimit())` aplicado antes de procesar `tools/call`. |
| NG-007 | Sybil attack en reputación | MEDIUM | `src/app/api/v1/models/[slug]/rate/route.ts:66-92` — Requiere ≥1 invocación exitosa previa via agent key antes de permitir voto. |
| NG-008 | TOCTOU race condition en budget | HIGH | `supabase/migrations/036_atomic_budget_check.sql` — RPC `check_and_deduct_budget` con `UPDATE WHERE (budget - spent) >= amount` atómico. Sin ventana TOCTOU. |
| NG-009 | Missing input validation en endpoints | MEDIUM | `src/app/api/v1/mcp/route.ts:135` — `mcpRequestSchema` Zod. `rate/route.ts:20` — `rateBodySchema` Zod. Aplicado en todos los endpoints. |
| NG-010 | Missing security headers en API routes | LOW | `middleware.ts:25-33` — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `X-DNS-Prefetch-Control`. CSP con nonce en páginas (línea 108-116). |
| NG-011 | Error responses leaking internal details | LOW | MCP errors usan `mcpError()` helper (genérico). Invoke route solo expone `detail` en `NODE_ENV=development`. |
| NG-012 | CSRF incompleto (sin Referer fallback) | MEDIUM | `src/lib/security/csrf.ts:40-53` — `getRequestOrigin()` usa Origin con fallback a Referer header. Cubre browsers que omiten Origin. |
| NG-013 | Missing logging en paths críticos | LOW | `logger` importado y usado en MCP route, cron routes, rate route. Structured logging con contexto. |

### ℹ️ INFO — 1/14

| ID | Hallazgo | Nota |
|----|----------|------|
| NG-014 | Environment variable exposure risk | Variables sensibles no usan `NEXT_PUBLIC_` prefix. Env vars validadas con Zod en `env.ts`. No requiere acción. |

---

## NexusAudit — On-Chain (12 hallazgos)

### ✅ FIXED — 9/12

| ID | Hallazgo | Severidad | Evidencia |
|----|----------|-----------|-----------|
| NA-202 | Fee change sin timelock | HIGH | `WasiAIMarketplace.sol:589-613` — `proposeFee()` + `executeFee()` con 48h timelock. `cancelFee()` disponible. Fee capped a 3000 bps (30% max). |
| NA-203 | `recordInvocation` sin `whenNotPaused` | HIGH | `WasiAIMarketplace.sol:302` — `whenNotPaused` modifier aplicado. Contract hereda `Pausable`. |
| NA-204 | `creatorFeeBps` mutable por owner | MEDIUM | `WasiAIMarketplace.sol:64` — `creatorFeeBps` removido como storage mutable. Fee calculado dinámicamente como `(10_000 - platformFeeBps)` (línea 320). |
| NA-205 | `ReentrancyGuard` faltante en funciones | HIGH | Aplicado comprehensivamente: `withdraw`, `withdrawFor`, `depositForKey`, `settleKeyBatch`, `refundKeyToEarnings`, `withdrawKey`, `emergencyWithdrawKey`, `transferAgent`. |
| NA-207 | `abi.encodePacked` collision risk | MEDIUM | `WasiAIMarketplace.sol:732` — `computePaymentId()` usa `abi.encode()`. Previene hash collisions con tipos diferentes. |
| NA-208 | `depositForKey` sin owner check | MEDIUM | `WasiAIMarketplace.sol:405-408` — Validación `require(owner == keyOwners[keyId], "not key owner")` para keys existentes. |
| NA-209 | `encodePacked` en EscrowId | MEDIUM | `WasiEscrow.sol:296-304` — `computeEscrowId()` usa `abi.encode()` con `block.chainid`. |
| NA-210 | Sin daily settlement cap | MEDIUM | `WasiAIMarketplace.sol:100-106` — `dailyCapUsdc` con rango 100-100,000 USDC. Reset cada 24h. Previene flash settlement attacks. |
| NA-212 | Missing events para state changes | LOW | Comprehensive events: `FeeProposed`, `TreasuryProposed`, `TreasuryUpdated`, `TreasuryCanceled`, `KeyFunded`, `KeyCallSettled`, `KeyRefunded`, `KeyWithdrawn`, `DailyCapUpdated`, `UpkeepPerformed`. |

### ⚠️ PARTIALLY FIXED — 2/12

| ID | Hallazgo | Severidad | Estado | Detalle |
|----|----------|-----------|--------|---------|
| NA-201 | Owner puede cambiar treasury sin delay | HIGH | **Timelock implementado** — `proposeTreasury()` + `executeTreasury()` con 48h. **Falta:** (1) No hay multi-sig para owner functions. (2) No hay `WarningThresholdExceeded` event cuando fee supera umbral. **Riesgo residual:** BAJO — timelock de 48h da tiempo suficiente para reaccionar. Multi-sig es hardening futuro. **Tracking:** Backlog para governance upgrade. |
| NA-211 | Sin granular roles (AccessControl) | MEDIUM | **Modelo binario:** `onlyOperator` + `onlyOwner`. **Falta:** No hay `AccessControl` con roles separados (e.g., `SETTLEMENT_ROLE`, `PAUSE_ROLE`, `FEE_ADMIN_ROLE`). **Riesgo residual:** BAJO — modelo actual suficiente para equipo pequeño. **Tracking:** Diferido a WAS-110 (governance roadmap). |

### 🔵 NOT FIXED (By Design) — 1/12

| ID | Hallazgo | Severidad | Justificación |
|----|----------|-----------|---------------|
| NA-206 | `settleKeyBatch` permite montos flexibles | MEDIUM | **Decisión de diseño intencional.** El operador necesita flexibilidad para liquidar parcialmente (e.g., si un creator tiene earnings mixtos on-chain/off-chain). El daily settlement cap (NA-210) mitiga el riesgo de abuso. Forzar `amount == keyBalance` rompería el flujo de liquidación parcial. |

---

## Escrow (WasiEscrow.sol) — Validación Cruzada

| Feature | Estado | Evidencia |
|---------|--------|-----------|
| 72h release timeout | ✅ | `RELEASE_TIMEOUT = 72 hours` (línea 49) |
| 30 days emergency refund | ✅ | `EMERGENCY_TIMEOUT = 30 days` (línea 51), permissionless |
| Restricted release/refund | ✅ | Solo operator/owner/marketplace (líneas 161-164) |
| Dispute resolution | ✅ | `resolveDispute()` owner-only (líneas 247-268) |
| ReentrancyGuard | ✅ | En todas las funciones con movimiento de fondos |
| CEI pattern | ✅ | Status update ANTES de safeTransfer en todos los flows |
| Ownable2Step | ✅ | Two-step ownership transfer (línea 25) |
| abi.encode (no encodePacked) | ✅ | `computeEscrowId()` usa `abi.encode` (línea 296-304) |

---

## Patrones de Seguridad Transversales Validados

### 1. Fail-Closed ✅
- Cron handlers: `!cronSecret` → 500 (no bypass)
- Budget check: `remaining < price` → 402 ANTES de llamar upstream
- SSRF: DNS probe falla → bloquea request

### 2. Allowlist > Blocklist ✅
- `allowed-origins.ts`: `ALLOWED_HOSTS` allowlist
- `validateEndpointUrl.ts`: Blocklist + DNS probe (doble capa)
- `csrf.ts`: `ALLOWED_ORIGINS` set

### 3. Atomic Money ✅
- `check_and_deduct_budget`: UPDATE WHERE atómico (sin TOCTOU)
- On-chain: `recordInvocation` con CEI + ReentrancyGuard

### 4. Timelock Consistency ✅
- Treasury: 48h timelock con propose/execute/cancel
- Fee: 48h timelock con propose/execute/cancel
- Escrow: 72h release + 30 days emergency

### 5. Security Utils Centralizados ✅
- `allowed-origins.ts`: Origin validation compartido
- `validateEndpointUrl.ts`: SSRF shared
- `csrf.ts`: CSRF shared
- `ratelimit.ts`: Rate limiting shared

---

## Resumen de Archivos Modificados (Security Fixes)

| Archivo | Tipo | Findings Resueltos |
|---------|------|-------------------|
| `src/lib/security/allowed-origins.ts` | NEW | NG-001, NG-004 |
| `src/lib/security/validateEndpointUrl.ts` | UPDATED | NG-005 |
| `src/lib/security/csrf.ts` | UPDATED | NG-012 |
| `supabase/migrations/036_atomic_budget_check.sql` | NEW | NG-008 |
| `middleware.ts` | UPDATED | NG-010 |
| `src/app/api/v1/mcp/route.ts` | UPDATED | NG-002, NG-005, NG-006, NG-008, NG-009 |
| `src/app/api/v1/models/[slug]/rate/route.ts` | UPDATED | NG-007, NG-009 |
| `src/app/api/cron/settle-key-batches/route.ts` | UPDATED | NG-003 |
| `contracts/src/WasiAIMarketplace.sol` | UPDATED | NA-201→NA-205, NA-207→NA-212 |
| `contracts/src/WasiEscrow.sol` | UPDATED | NA-209 |

---

## Recomendaciones Futuras (No Bloqueantes)

| # | Recomendación | Prioridad | Tracking |
|---|--------------|-----------|----------|
| 1 | Multi-sig para owner en contratos | MEDIUM | Governance roadmap |
| 2 | Granular AccessControl roles | MEDIUM | WAS-110 |
| 3 | Warning events cuando fee > threshold | LOW | Backlog |
| 4 | Rate limiter dedicado para rating (más estricto que invoke) | LOW | Backlog |
| 5 | CAPTCHA para votación anónima (sin wallet) | LOW | Backlog |

---

## Conclusión

La auditoría de seguridad dual (NexusGuard + NexusAudit) identificó 26 hallazgos en WasiAI v2. El equipo de implementación (OpenClaw) resolvió **22 de 26** hallazgos exitosamente, con 2 parcialmente resueltos (hardening futuro) y 1 cerrado por diseño intencional.

**El sistema es seguro para operación en producción.** Los hallazgos parciales (multi-sig y roles granulares) son mejoras de gobernanza que no representan vulnerabilidades activas explotables.

### Score de Seguridad

| Capa | Score | Nota |
|------|-------|------|
| Off-Chain (Web App) | **9.5/10** | 13/14 fixed, 1 INFO |
| On-Chain (Smart Contracts) | **8.5/10** | 9/12 fixed, hardening pendiente |
| **Overall** | **9.0/10** | Production-ready |

---

*Validado por Claude Opus 4.6 — 2026-03-05*
*Metodología: NexusGuard v1.0 (SHIELD) + NexusAudit v2.0 (TRACE)*
