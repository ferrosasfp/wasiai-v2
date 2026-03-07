# Work Item — 063: x402 Payment Flow for Embedded Wallets

**Classification:** HU-MAJOR
**Priority:** P0 — BLOCKER for demo Monday
**Sprint:** 17 (hotfix)

---

## Problem

The x402 payment flow requires EIP-3009 (transferWithAuthorization) which needs `signTypedData`. Thirdweb embedded wallets (smart accounts) cannot produce this signature. The fallback approve flow approves USDC spending but the subsequent invoke still returns 402 because no valid x402 payment header is sent.

Flow today:
1. Client → invoke → 402 (x402 requirements)
2. Client tries EIP-3009 → skip (embedded wallet)
3. Client does approve(USDC) → ✅ succeeds (gasless)
4. Client retries invoke → still 402 ❌ (no valid payment header)

## Root Cause

After approve, the client retries the invoke but still needs to provide a valid x402 payment header. The approve only authorized the contract to spend USDC, but nobody called transferFrom to actually move the funds. The x402 facilitator expects a signed authorization, not an approve.

## Desired Outcome

Embedded wallet users can pay for agent calls end-to-end. The flow should be:
1. User clicks "Pay" → approve USDC (gasless) → transferFrom executed → agent called → result displayed.

## Acceptance Criteria

1. **AC-1:** Embedded wallet user can complete a paid agent call end-to-end
2. **AC-2:** External wallet (MetaMask) flow unchanged
3. **AC-3:** Gas sponsored for embedded wallet users
4. **AC-4:** Agent response displayed after payment
5. **AC-5:** Build passes clean

## Technical Options

**Option A — Server-side transferFrom after approve:**
After client approves, server calls transferFrom using operator wallet, then invokes agent. Requires operator to have permission.

**Option B — Client-side transferFrom via smart account:**
After approve, client executes transferFrom via thirdweb smart account (gasless), then retries invoke with proof of payment (txHash).

**Option C — Skip x402 for embedded wallets:**
Use direct USDC transfer (approve+transferFrom) instead of x402 protocol. Server verifies USDC received, then invokes agent.
