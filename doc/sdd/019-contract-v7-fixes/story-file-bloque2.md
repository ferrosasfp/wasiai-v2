# Story File — Sprint 9 Bloque 2: Edge Cases + Fuzz + Deploy Fuji v7

## Context

Contract v7 is already deployed to local test environment with 78 passing tests.
Goal: expand test suite to ~108 tests, then deploy to Fuji testnet.

Contract: `contracts/src/WasiAIMarketplace.sol`
Tests: `contracts/test/WasiAIMarketplace.t.sol`
forge binary: `~/.foundry/bin/forge`
Working dir: `/home/ferdev/.openclaw/workspace/wasiai-v2/contracts`

---

## Wave 1 — Edge Case Tests (WAS-113)

Add to `contracts/test/WasiAIMarketplace.t.sol` a new section at the bottom:

```solidity
// ── Edge Cases ────────────────────────────────────────────────────────────────
```

Write these tests:

### Fee edge cases
```solidity
// fee = 0 bps: creator gets 100%
function test_EdgeCase_ZeroFee_CreatorGetsAll() public {
    vm.prank(owner);
    marketplace.setPlatformFee(0);
    usdc.mint(address(marketplace), PRICE);
    vm.prank(operator);
    marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("pid-zero-fee"));
    assertEq(marketplace.getPendingEarnings(creator), PRICE);
    assertEq(usdc.balanceOf(treasury), 0);
}

// fee = 3000 bps (max): treasury gets 30%
function test_EdgeCase_MaxFee_Treasury30pct() public {
    vm.prank(owner);
    marketplace.setPlatformFee(3000);
    usdc.mint(address(marketplace), PRICE);
    vm.prank(operator);
    marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("pid-max-fee"));
    assertEq(usdc.balanceOf(treasury), PRICE * 3000 / 10000);
    assertEq(marketplace.getPendingEarnings(creator), PRICE - (PRICE * 3000 / 10000));
}

// fee = 3001 bps: must revert
function test_EdgeCase_FeeAboveMax_Reverts() public {
    vm.prank(owner);
    vm.expectRevert("WasiAI: max 30%");
    marketplace.setPlatformFee(3001);
}
```

### Batch edge cases
```solidity
// batch = 1 item: works
function test_EdgeCase_BatchSize1() public { ... }

// batch = 500 items (max allowed): works
function test_EdgeCase_BatchSize500() public { ... }

// batch = 501 items: reverts (WAS-110 fix)
function test_EdgeCase_BatchSize501_Reverts() public {
    // already covered in NexusAudit FIXED test — reference only
}
```

### Amount edge cases
```solidity
// amount = 1 (minimum USDC): reverts — wrong amount (WAS-105 fix)
function test_EdgeCase_AmountOne_Reverts() public {
    usdc.mint(address(marketplace), 1);
    vm.prank(operator);
    vm.expectRevert("WasiAI: amount mismatch");
    marketplace.recordInvocation(SLUG, payer, 1, keccak256("pid-one"));
}

// amount = pricePerCall exactly: works
function test_EdgeCase_AmountExact_Works() public {
    usdc.mint(address(marketplace), PRICE);
    vm.prank(operator);
    marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("pid-exact"));
    assertGt(marketplace.getPendingEarnings(creator), 0);
}
```

### Multiple creators same agent — earnings isolation
```solidity
function test_EdgeCase_EarningsIsolation_TwoCreators() public {
    // Register two agents with different creators
    // Settle calls to each
    // Verify earnings[creator1] and earnings[creator2] are independent
}
```

### Pause edge cases (WAS-106 fix)
```solidity
// depositForKey reverts when paused
function test_EdgeCase_DepositWhenPaused_Reverts() public { ... }

// settleKeyBatch reverts when paused
function test_EdgeCase_SettleWhenPaused_Reverts() public { ... }

// withdraw still works when paused (pull pattern preserved)
function test_EdgeCase_WithdrawWhenPaused_Works() public { ... }

// unpause restores normal operation
function test_EdgeCase_UnpauseRestoresOperation() public { ... }
```

---

## Wave 2 — Fuzz Tests (WAS-114)

Add fuzz tests to `contracts/test/WasiAIMarketplace.t.sol`:

```solidity
// ── Fuzz Tests ────────────────────────────────────────────────────────────────

// Fuzz fee value: any bps <= 3000 should work, >3000 should revert
function testFuzz_SetPlatformFee(uint16 bps) public {
    vm.prank(owner);
    if (bps > 3000) {
        vm.expectRevert("WasiAI: max 30%");
        marketplace.setPlatformFee(bps);
    } else {
        marketplace.setPlatformFee(bps);
        assertEq(marketplace.platformFeeBps(), bps);
    }
}

// Fuzz batch size: any size > 500 should revert, <= 500 should work (if funded)
function testFuzz_SettleKeyBatch_SizeCap(uint16 size) public {
    vm.assume(size > 0 && size <= 600);
    // setup...
    if (size > 500) {
        vm.expectRevert("WasiAI: batch too large");
    }
    // call settleKeyBatch with `size` elements
}

// Fuzz recordInvocation amount: only exact pricePerCall should work
function testFuzz_RecordInvocation_AmountMismatch(uint256 amount) public {
    vm.assume(amount > 0 && amount != PRICE);
    usdc.mint(address(marketplace), amount);
    vm.prank(operator);
    vm.expectRevert("WasiAI: amount mismatch");
    marketplace.recordInvocation(SLUG, payer, amount, keccak256(abi.encode(amount)));
}
```

---

## Wave 3 — Integration Flow Tests (WAS-115)

```solidity
// ── Integration Flows ─────────────────────────────────────────────────────────

// Full Flow A: deposit → multiple settles → refund → withdraw
function test_Integration_FullKeyLifecycle() public {
    // 1. User funds key with $5.00
    // 2. 10 calls settled ($0.10 each = $1.00)
    // 3. Remaining $4.00 refunded to earnings
    // 4. User withdraws all earnings
    // 5. Assert final state: key=0, earnings=0, user has $4.00 USDC
}

// Full Flow B: x402 direct → multiple invocations → creator withdraw
function test_Integration_DirectPaymentFlow() public {
    // 1. Contract funded with 5 x PRICE
    // 2. 5 invocations recorded (each with unique paymentId)
    // 3. Creator withdraws all earnings
    // 4. Assert: treasury got 5*10%, creator got 5*90%
}

// Full Flow C: Pause → pending operations → unpause → resume
function test_Integration_PauseResumeCycle() public {
    // 1. Fund key
    // 2. Pause contract
    // 3. Try depositForKey → revert
    // 4. Try settleKeyBatch → revert
    // 5. withdraw() still works (not paused)
    // 6. Unpause
    // 7. depositForKey → works again
}

// Full Flow D: Emergency exit after real operator inactivity (no performUpkeep interference)
function test_Integration_EmergencyExitFlow() public {
    // 1. Fund key
    // 2. 30 days + 1 second pass (no activity)
    // 3. performUpkeep called by attacker (should NOT reset lastOperatorActivity)
    // 4. emergencyWithdrawKey → SUCCESS (v7 fix confirmed in integration context)
}
```

---

## Wave 4 — Run Full Test Suite

```bash
cd contracts && forge test -vv 2>&1
```

Target: 108+ tests, 0 failures.

If any test fails, fix it before continuing.

---

## Wave 5 — Deploy Fuji v7

Read `.env.local` to get:
- `OPERATOR_PRIVATE_KEY`
- `NEXT_PUBLIC_WASIAI_TREASURY_ADDRESS`
- `NEXT_PUBLIC_WASIAI_USDC_ADDRESS` (Fuji USDC: `0x5425890298aed601595a70AB815c96711a31Bc65`)

Deploy command:
```bash
cd contracts && ~/.foundry/bin/forge script script/Deploy.s.sol \
  --rpc-url https://api.avax-test.network/ext/bc/C/rpc \
  --broadcast \
  --verify \
  2>&1
```

If Deploy.s.sol doesn't exist, create it:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Script.sol";
import "../src/WasiAIMarketplace.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("OPERATOR_PRIVATE_KEY");
        address treasury    = vm.envAddress("WASIAI_TREASURY_ADDRESS");
        address usdc        = vm.envAddress("WASIAI_USDC_ADDRESS");
        vm.startBroadcast(deployerKey);
        WasiAIMarketplace marketplace = new WasiAIMarketplace(usdc, treasury);
        vm.stopBroadcast();
        console.log("WasiAIMarketplace v7 deployed at:", address(marketplace));
    }
}
```

Env vars to read from `/home/ferdev/.openclaw/workspace/wasiai-v2/.env.local`.

After deploy, note the new contract address.

---

## Wave 6 — Update .env.local and Vercel

Update `NEXT_PUBLIC_WASIAI_CONTRACT_ADDRESS` in `.env.local` with new v7 address.

Update Vercel:
```bash
VERCEL=~/.npm-global/bin/vercel
vercel env rm NEXT_PUBLIC_WASIAI_CONTRACT_ADDRESS preview --yes
echo "NEW_ADDRESS" | vercel env add NEXT_PUBLIC_WASIAI_CONTRACT_ADDRESS preview
vercel env rm NEXT_PUBLIC_WASIAI_CONTRACT_ADDRESS production --yes
echo "NEW_ADDRESS" | vercel env add NEXT_PUBLIC_WASIAI_CONTRACT_ADDRESS production
```

---

## Wave 7 — Commit

```bash
git add contracts/test/WasiAIMarketplace.t.sol
git commit -m "test(sprint9): edge cases + fuzz + integration — 108+ tests green"
git push origin master master:main
```

Report: new contract address, total test count, any issues.

---

## Constraints

- Read every file before modifying
- OPERATOR_PRIVATE_KEY is in .env.local — use it for deploy
- Fuji USDC: `0x5425890298aed601595a70AB815c96711a31Bc65`
- Treasury: read from .env.local (`NEXT_PUBLIC_WASIAI_TREASURY_ADDRESS`)
- If deploy script fails, report the error and stop — do not guess
- git push: `git push origin master master:main`
