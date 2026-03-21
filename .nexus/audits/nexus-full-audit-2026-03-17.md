# WasiAI Full Audit Report — 2026-03-17

**Auditor:** San (NexusAudit v2.0 + NexusGuard v1.0)  
**Date:** 2026-03-17 02:04 CST  
**Scope:** Smart Contract (WasiAIMarketplace.sol) + Web App (Next.js 14) + QA funcional prod  
**Contract:** `0x9316E902760f2c37CDA57C8Be01358D890a26276` (Avalanche C-Chain mainnet)  
**App:** https://wasiai-prod.vercel.app

---

## Executive Summary

**Overall Risk: 🟠 HIGH** — Smart contract is in good shape (all 4 previous findings fixed), but the web app still has **3 unpatched findings from NexusGuard v1** including 2 CRITICALs (admin endpoints without server-side auth). Additionally, 2 settlement failures are pending in prod and the `/api/admin/fee` GET endpoint is also unauthenticated (new finding).

### Scorecard

| Layer | Risk | Notes |
|---|---|---|
| Smart Contract | 🟢 LOW | All 4 NexusAudit v2 fixes confirmed in source. 220/220 tests pass. No new findings. |
| Web App | 🔴 CRITICAL | 3 admin endpoints still publicly accessible without auth (treasury, status, fee) |
| QA Funcional | 🟡 MEDIUM | 2 settlement failures pending. Catalog + capabilities endpoints healthy. |

---

## NexusAudit — Smart Contract Findings

### Previous Findings Status (NexusAudit v2, 2026-03-16)

| Finding | Severity | Status | Verification |
|---|---|---|---|
| HIGH-1: `claimEarnings` balance guard missing `totalEarnings` | 🟠 HIGH | ✅ **FIXED** | Line ~407: `usdc.balanceOf(address(this)) - totalKeyBalances - totalEarnings >= grossAmount` |
| HIGH-2: `recordInvocation` soft check ignores obligations | 🟠 HIGH | ✅ **FIXED** | Line ~318: `usdc.balanceOf(address(this)) - totalKeyBalances - totalEarnings >= amount` |
| MEDIUM-1: `performUpkeep` no access control | 🟡 MEDIUM | ✅ **FIXED** | Now has `onlyOperator` modifier |
| LOW-1: `updateAgent` missing `whenNotPaused` | 🟢 LOW | ✅ **FIXED** | Now has `whenNotPaused` modifier |
| INFO-1: Emergency timeout blockable by operator | ℹ️ INFO | ⏸️ DEFERRED | By design — documented known limitation |
| INFO-2: Registration fees untracked | ℹ️ INFO | ⏸️ DEFERRED | No change |
| INFO-3: String mapping key gas inefficiency | ℹ️ INFO | ⏸️ DEFERRED | No change |

### New Findings (2026-03-17)

**No new smart contract vulnerabilities found.** The contract code was re-examined for:

- ✅ Reentrancy in batchSelfRegister, settleKeyBatch — protected by `nonReentrant` and no external calls mid-loop
- ✅ Access control on all functions — comprehensive coverage verified
- ✅ Integer overflow/underflow — Solidity 0.8.24 checked arithmetic
- ✅ Frontrunning — no price oracle, paymentId idempotency, nonce protection
- ✅ ERC-3009 signature validation — delegated to USDC contract (replay-safe)
- ✅ Daily cap bypass — post-loop check with `_checkAndResetDailyWindow()` is correct
- ✅ Operator privilege abuse — both balance guards now subtract obligations
- ✅ Emergency mechanism — `withdrawKey` always available (no pause required)
- ✅ Gas griefing in loops — max 500 items, no external calls in loop body
- ✅ Event emission completeness — all state changes emit events

---

## NexusGuard — Web App Findings

### Previous Findings Status (NexusGuard v1, 2026-03-16)

| Finding | Severity | Status | Verification |
|---|---|---|---|
| NG-C01: Admin treasury no auth | 🔴 CRITICAL | ❌ **NOT FIXED** | `curl https://wasiai-prod.vercel.app/api/admin/treasury` → 200 with full financial data |
| NG-C02: Admin status no auth | 🔴 CRITICAL | ❌ **NOT FIXED** | `curl https://wasiai-prod.vercel.app/api/admin/status` → 200 with operator balance, alerts |
| NG-H01: EIP-712 nonce not persisted | 🟠 HIGH | ❓ UNVERIFIED | Cannot confirm without code deploy; likely still open |
| NG-H02: SSRF sync (no DNS probe) | 🟠 HIGH | ❓ UNVERIFIED | Cannot confirm without source diff; likely still open |
| NG-M01: Missing HSTS | 🟡 MEDIUM | ✅ **FIXED** | Header now present: `strict-transport-security: max-age=63072000; includeSubDomains; preload` |
| NG-M02: CORS incomplete on invoke | 🟡 MEDIUM | ❓ UNVERIFIED | |
| NG-M03: Sandbox anonymous abuse | 🟡 MEDIUM | ❓ UNVERIFIED | |
| NG-L01: CSP unsafe-inline styles | 🟢 LOW | ⏸️ DEFERRED | |
| NG-L02: CSP stale facilitator URL | 🟢 LOW | ❓ UNVERIFIED | |
| NG-L03: npm audit / .env.example | 🟢 LOW | ❓ UNVERIFIED | |

### New Finding

#### 🔴 NG-C03: Admin Fee Endpoint Sin Autenticación Server-Side (NEW)

| Campo | Valor |
|---|---|
| Severity | 🔴 CRITICAL |
| Confidence | CONFIRMED |
| Location | `GET /api/admin/fee` |

**PoC:**
```bash
curl -s https://wasiai-prod.vercel.app/api/admin/fee
# Returns: {"platformFeeBps":1000,"pendingFeeBps":0,"pendingFeeTimestamp":"0","executeAfter":null}
```

**Impact:** Exposes current platform fee (1000 bps = 10%), and whether a fee change is pending. While less sensitive than treasury/status, it follows the same pattern of client-side-only auth. The POST endpoint correctly returns 401 without auth.

**Recommendation:** Add the same EIP-712 auth as settlement/fee POST endpoints.

### Currently Exposed Data Summary (Confirmed via curl, no auth)

| Endpoint | HTTP | Status | Data Exposed |
|---|---|---|---|
| `/api/admin/treasury` | GET | 200 ❌ | Contract USDC: **$4.11**, key balances: **$4.10**, treasury addr, fee bps |
| `/api/admin/status` | GET | 200 ❌ | Operator AVAX: **0.90**, settlement mode, **2 failures pending**, x402 health alert |
| `/api/admin/fee` | GET | 200 ❌ | Fee: 1000 bps, no pending changes |
| `/api/admin/settlement` | GET | 405 ✅ | Method not allowed (correct) |
| `/api/admin/settlement` | POST | 400 ✅ | Requires body (auth would trigger on valid request) |
| `/api/admin/fee` | POST | 401 ✅ | Correctly requires auth |

---

## QA Funcional

### API Catalog

| Check | Result |
|---|---|
| `GET /api/v1/models` | ✅ 200 — 7 models listed |
| `GET /api/v1/capabilities` | ✅ 200 — 7 agents with correct contract address |
| Contract address in responses | ✅ `0x9316E902760f2c37CDA57C8Be01358D890a26276` (correct mainnet V2) |
| ERC-8004 identity | ✅ All agents show `0xBF9554c33A8E743518aeD49d1A3c9e175a5f9967` |

### Agent Calls (DB)

| Field | Call 1 | Call 2 |
|---|---|---|
| Agent | wasi-chainlink-price | wasi-chainlink-price |
| Called At | 2026-03-17 07:51:24 UTC | 2026-03-17 07:51:45 UTC |
| Status | success | success |
| Payment | free_trial ($0.00) | x402 ($0.01) |
| Latency | 4140ms | 1953ms |
| Settlement | not settled | not settled (has tx_hash) |
| is_trial | true | false |

✅ Recent calls present in DB. The x402 call (Call 2) has `tx_hash` but `settled_at` is null — consistent with the 2 pending settlement failures reported in admin/status.

### 🟡 Settlement Failures

The admin/status endpoint reports:
```json
{
  "settlement_failures_pending": 2,
  "x402_health": {
    "alert": "CRITICAL: 2 settlement failures pending"
  }
}
```

**Assessment:** 2 settlement failures are pending. The system's own alerting flags this as CRITICAL. These are likely `recordInvocation` calls that failed on-chain (possibly gas issues or timing). The operator AVAX balance (0.90 AVAX) appears healthy, so this may be a transient issue or a logic bug in the settlement cron.

---

## Forge Tests

```
Suite result: ok. 220 passed; 0 failed; 0 skipped
Ran 7 test suites in 239.25ms
```

All 220 tests pass, including the 8 NexusAudit PoC tests from the previous audit.

---

## Risk Matrix

| # | Finding | Severity | Layer | Status | Fix Effort |
|---|---|---|---|---|---|
| 1 | NG-C01: Treasury endpoint no auth | 🔴 CRITICAL | Web | ❌ OPEN | 30 min |
| 2 | NG-C02: Status endpoint no auth | 🔴 CRITICAL | Web | ❌ OPEN | 30 min |
| 3 | NG-C03: Fee GET endpoint no auth | 🔴 CRITICAL | Web | ❌ OPEN (NEW) | 30 min |
| 4 | NG-H01: EIP-712 nonce replay | 🟠 HIGH | Web | ❌ LIKELY OPEN | 2h |
| 5 | NG-H02: SSRF sync (DNS rebind) | 🟠 HIGH | Web | ❌ LIKELY OPEN | 1h |
| 6 | Settlement failures (2 pending) | 🟡 MEDIUM | Ops | ⚠️ ACTIVE | Investigate |
| 7 | NG-M02: CORS invoke incomplete | 🟡 MEDIUM | Web | ❓ UNVERIFIED | 30 min |
| 8 | NG-M03: Sandbox anon abuse | 🟡 MEDIUM | Web | ❓ UNVERIFIED | 1h |
| 9 | INFO-1: Emergency timeout blockable | ℹ️ INFO | Contract | ⏸️ DEFERRED | Major |
| 10 | INFO-2: Registration fees untracked | ℹ️ INFO | Contract | ⏸️ DEFERRED | Minor |

---

## Recommended Actions

### P0 — Immediate (before next business day)
1. **Fix admin auth on GET endpoints** (treasury, status, fee) — add EIP-712 signature verification or at minimum a shared secret header. This is the single most impactful security improvement.
2. **Investigate 2 settlement failures** — check settlement cron logs. The x402 call from 07:51 UTC has a tx_hash but no `settled_at`.

### P1 — This week
3. **Persist EIP-712 nonces** in Redis to prevent replay attacks within the 5-min window (NG-H01).
4. **Use `validateEndpointUrlAsync`** (with DNS probe) in invoke/compose routes instead of sync version (NG-H02).

### P2 — This sprint
5. Complete CORS headers on invoke endpoint (NG-M02).
6. Strengthen sandbox anonymous rate limiting (NG-M03).

### Backlog
7. Emergency timeout redesign (INFO-1) — requires major architecture change.
8. Registration fee sweep function (INFO-2).

---

## Known Limitations

1. **Source code diff not available** — web app findings NG-H01, NG-H02, NG-M02, NG-M03 could not be re-verified against current deployed code. Status based on prod endpoint testing only.
2. **Property-based / fuzz testing not executed** — no Vitest fuzzing in this audit cycle.
3. **Supabase RLS** — not re-audited in this cycle (covered in NexusGuard v1).
4. **On-chain contract verification** — the deployed bytecode was not compared against source in this cycle. Previous audit confirmed Snowtrace verification.
5. **SSRF testing** — DNS rebinding attack not executed against prod (would require controlled domain setup).

---

*Report generated by San — NexusAudit v2.0 + NexusGuard v1.0 — 2026-03-17 02:30 CST*
