# Build Report — WAS-216 Logic Audit Fix

**Branch:** `feat/216-marketplace-v2`  
**Commit:** `24bb92e8f`  
**Builder:** NexusAgil v1.3  
**Date:** 2026-03-16  

---

## Summary

All 5 findings from the Logic Audit applied and verified. 212 tests pass, 0 failures.

---

## Findings Applied

### 🔴 BLOQUEANTE — Finding #1: Intra-batch duplicates in `batchSelfRegister`

**Root cause:** Pre-check loop only verified slugs against storage, not within the batch itself. `["a","a"]` could overwrite the first registration.

**Fix:** Added O(n²) inner loop in the pre-check of `batchSelfRegister`:
```solidity
for (uint256 j = 0; j < i; j++) {
    require(
        keccak256(bytes(slugs[i])) != keccak256(bytes(slugs[j])),
        string(abi.encodePacked("WasiAI: duplicate slug in batch: ", slugs[i]))
    );
}
```
Safe for n≤50 (max batch size enforced upstream).

**Tests added:**
- `test_batchSelfRegister_IntraBatchDuplicate_Reverts` — verifies `["slug-a","slug-a"]` reverts
- `test_batchSelfRegister_IntraBatchDuplicate_ExactMessage` — verifies exact revert message

---

### 🟡 MENOR — Finding #2: Missing slug length validation in `batchSelfRegister`

**Fix:** Added in pre-check loop before `agents[]` check:
```solidity
require(
    bytes(slugs[i]).length > 0 && bytes(slugs[i]).length <= 80,
    "WasiAI: invalid slug length"
);
```

**Tests added:**
- `test_batchSelfRegister_EmptySlug_Reverts`
- `test_batchSelfRegister_SlugTooLong_Reverts`

---

### 🟡 MENOR — Finding #3: Missing price range validation in `batchSelfRegister`

**Fix:** Added in pre-check loop:
```solidity
require(
    prices[i] >= 1_000 && prices[i] <= 100_000_000,
    "WasiAI: invalid price"
);
```

**Tests added:**
- `test_batchSelfRegister_PriceTooLow_Reverts`
- `test_batchSelfRegister_PriceTooHigh_Reverts`

---

### 🟡 MENOR — Finding #4: `SettlementSkipped` event not verified in tests

**Fix:** Added `vm.expectEmit` + `emit SettlementSkipped(...)` before `settleKeyBatch` calls in:
- `test_settleKeyBatch_Graceful_SkipsUnregistered` — 2 skipped slugs, 2 expectEmit
- `test_settleKeyBatch_Graceful_KeyBalanceCorrect` — 1 skipped slug, 1 expectEmit

---

### 🟡 MENOR — Finding #5: `emergencyWithdrawUSDC` without tests

**Tests added (6 total):**
- `test_emergencyWithdrawUSDC_HappyPath_TransfersOnlyExcess` — owner + paused → transfers only excess
- `test_emergencyWithdrawUSDC_OnlyOwner_Reverts` — non-owner reverts
- `test_emergencyWithdrawUSDC_WhenNotPaused_Reverts` — reverts if not paused
- `test_emergencyWithdrawUSDC_NoExcess_Reverts` — reverts with "WasiAI: no excess USDC"
- `test_emergencyWithdrawUSDC_ZeroAddress_Reverts` — reverts with "WasiAI: zero address"
- `test_emergencyWithdrawUSDC_Invariant_SolvencyPreserved` — post-withdraw `balanceOf(contract) >= totalKeyBalances + totalEarnings`

---

## Build & Test Results

```
forge build  → ✅ 0 errors (warnings are pre-existing, none new)
forge test   → ✅ 212 passed, 0 failed, 0 skipped
```

**New tests added:** 13  
**Total test suite:** 212 tests across 6 suites

---

## Files Modified

- `contracts/src/WasiAIMarketplace.sol` — pre-check loop in `batchSelfRegister` (+14 lines)
- `contracts/test/WasiAIMarketplace.t.sol` — new test coverage (+177 lines)

---

## Commit

```
fix(WAS-216): batchSelfRegister — intra-batch duplicate check + slug/price validation + test coverage
Commit: 24bb92e8f
Branch: feat/216-marketplace-v2
```

No git push performed (as instructed).
