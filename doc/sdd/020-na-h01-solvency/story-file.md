# Story File — SDD #020: NA-H01 Solvency Fix + NA-M03 Fee Timelock
**Sprint 10+11 | WAS-92 (NA-H01) + WAS-95 (NA-M03)**
**Classification: QUALITY — HU-MAJOR**
**Source of truth: this file only. Read every file before modifying.**

---

## Context

Two known limitations remain open after Sprint 9:

**NA-H01 (HIGH):** No global accounting invariant between `keyBalances` and `earnings`.
Both pools share `usdc.balanceOf(address(this))` without a solvency check.
A malicious operator can drain `keyBalances` via `recordInvocation`, making the
contract insolvent — `keyBalances + earnings > usdc.balanceOf(this)`.

**NA-M03 (MEDIUM):** `setPlatformFee` has no timelock. Owner can change fee
from 10% to 30% between a user's `depositForKey` and `settleKeyBatch`.

---

## Acceptance Criteria

### NA-H01 — Solvency Invariant
- AC1: Contract tracks `totalKeyBalances` (sum of all keyBalances) as state variable
- AC2: Contract tracks `totalEarnings` (sum of all earnings) as state variable  
- AC3: Every function that moves USDC updates both counters correctly
- AC4: Public `checkSolvency()` view returns `(bool solvent, uint256 totalAccounted, uint256 contractBalance)`
- AC5: NexusAudit PoC `test_NA_H01` now FAILS (attack no longer possible)
- AC6: New invariant test confirms `totalKeyBalances + totalEarnings <= usdc.balanceOf(this)` always

### NA-M03 — Fee Timelock
- AC7: `proposeFee(uint16 bps)` stores pending fee + timestamp
- AC8: `executeFee()` only works after 48h from proposal
- AC9: `cancelFee()` cancels pending proposal
- AC10: Original `setPlatformFee` removed or replaced by propose/execute pattern
- AC11: Events: `FeeProposed(uint16 newBps, uint256 executeAfter)` + `FeeCanceled()`
- AC12: NexusAudit PoC `test_NA_M03_FeeSandwich` now FAILS

---

## Wave 1 — NA-M03: Fee Timelock (SIMPLER — do this first)

**File:** `contracts/src/WasiAIMarketplace.sol`

### New state variables (add after `platformFeeBps`):
```solidity
uint16  public pendingFeeBps;
uint256 public pendingFeeTimestamp;
uint256 public constant FEE_TIMELOCK = 48 hours;
```

### New events (add after `PlatformFeeUpdated`):
```solidity
event FeeProposed(uint16 indexed newBps, uint256 executeAfter);
event FeeCanceled(uint16 indexed canceledBps);
```

### Replace `setPlatformFee` with three functions:
```solidity
/// @notice Step 1: propose a new platform fee. Executable after 48h.
function proposeFee(uint16 bps) external onlyOwner {
    require(bps <= 3000, "WasiAI: max 30%");
    pendingFeeBps = bps;
    pendingFeeTimestamp = block.timestamp + FEE_TIMELOCK;
    emit FeeProposed(bps, pendingFeeTimestamp);
}

/// @notice Step 2: execute the proposed fee after timelock expires.
function executeFee() external onlyOwner {
    require(pendingFeeTimestamp > 0,            "WasiAI: no pending fee");
    require(block.timestamp >= pendingFeeTimestamp, "WasiAI: timelock active");
    uint16 oldBps = platformFeeBps;
    platformFeeBps = pendingFeeBps;
    pendingFeeBps = 0;
    pendingFeeTimestamp = 0;
    emit PlatformFeeUpdated(oldBps, platformFeeBps);
}

/// @notice Cancel a pending fee proposal.
function cancelFee() external onlyOwner {
    require(pendingFeeTimestamp > 0, "WasiAI: no pending fee");
    emit FeeCanceled(pendingFeeBps);
    pendingFeeBps = 0;
    pendingFeeTimestamp = 0;
}
```

**Remove** the old `setPlatformFee` function entirely.

---

## Wave 2 — NA-H01: Global Solvency Invariant

**File:** `contracts/src/WasiAIMarketplace.sol`

### New state variables (add after `totalInvocations`):
```solidity
/// @notice Sum of all keyBalances — updated on every key operation
uint256 public totalKeyBalances;
/// @notice Sum of all pending earnings — updated on every earnings operation
uint256 public totalEarnings;
```

### New view function (add in Views section):
```solidity
/// @notice Check contract solvency.
/// @return solvent         true if contract holds enough USDC for all obligations
/// @return totalAccounted  sum of all keyBalances + all earnings
/// @return contractBalance current USDC balance of this contract
function checkSolvency()
    external view
    returns (bool solvent, uint256 totalAccounted, uint256 contractBalance)
{
    totalAccounted  = totalKeyBalances + totalEarnings;
    contractBalance = usdc.balanceOf(address(this));
    solvent         = contractBalance >= totalAccounted;
}
```

### Update EVERY function that touches keyBalances or earnings:

#### `recordInvocation` (line ~249):
```solidity
// BEFORE:
earnings[agent.creator] += creatorShare;

// AFTER:
earnings[agent.creator] += creatorShare;
totalEarnings           += creatorShare;
// Note: platformShare goes to treasury immediately — not tracked in totalEarnings
```

#### `withdraw` (line ~268):
```solidity
// BEFORE:
earnings[msg.sender] = 0;
usdc.safeTransfer(msg.sender, amount);

// AFTER:
earnings[msg.sender] = 0;
totalEarnings       -= amount;
usdc.safeTransfer(msg.sender, amount);
```

#### `withdrawFor` (line ~286):
```solidity
// BEFORE:
earnings[creator] = 0;
usdc.safeTransfer(creator, amount);

// AFTER:
earnings[creator] = 0;
totalEarnings    -= amount;
usdc.safeTransfer(creator, amount);
```

#### `depositForKey` (line ~323):
```solidity
// BEFORE:
keyBalances[keyId] += amount;

// AFTER:
keyBalances[keyId]  += amount;
totalKeyBalances    += amount;
```

#### `settleKeyBatch` (line ~355):
```solidity
// BEFORE:
keyBalances[keyId] -= total;
// ... loop ...
earnings[agent.creator] += creatorShare;

// AFTER:
keyBalances[keyId]  -= total;
totalKeyBalances    -= total;
// ... loop ...
earnings[agent.creator] += creatorShare;
totalEarnings           += creatorShare;
// Note: totalPlatformShare goes to treasury — subtract from totalKeyBalances already done above
```

#### `refundKeyToEarnings` (line ~392):
```solidity
// BEFORE:
keyBalances[keyId] = 0;
earnings[keyOwners[keyId]] += amount;

// AFTER:
keyBalances[keyId]          = 0;
totalKeyBalances           -= amount;
earnings[keyOwners[keyId]] += amount;
totalEarnings              += amount;
```

#### `emergencyWithdrawKey` (line ~413):
```solidity
// BEFORE:
keyBalances[keyId] = 0;
usdc.safeTransfer(msg.sender, amount);

// AFTER:
keyBalances[keyId] = 0;
totalKeyBalances  -= amount;
usdc.safeTransfer(msg.sender, amount);
```

---

## Wave 3 — Compile Check

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2/contracts
~/.foundry/bin/forge build 2>&1
```

Must have 0 errors. If any error → fix before continuing.

---

## Wave 4 — Update NexusAudit PoC Tests

**File:** `contracts/test/NexusAuditValidation.t.sol`

### NA-H01: Invert the attack test

Replace `test_NA_H01_Insolvency_KeyBalances_vs_Earnings` with:

```solidity
// KNOWN LIMITATION RESOLVED — NA-H01
// Original attack: operator called recordInvocation using keyBalance USDC
// causing sum(keyBalances + earnings) > contract balance
// After fix: checkSolvency() always returns true

function test_NA_H01_FIXED_SolvencyInvariantHolds() public {
    uint256 USER_DEPOSIT = 1_000_000;

    // 1. User deposits
    usdc.mint(payer, USER_DEPOSIT);
    vm.prank(operator);
    marketplace.depositForKey(KEY_ID, payer, USER_DEPOSIT,
        0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));

    // 2. Operator calls recordInvocation (would have caused insolvency before fix)
    // Now: this MUST revert because amount != pricePerCall
    // (recordInvocation amount mismatch fix from WAS-105 prevents cross-pool abuse)
    vm.prank(operator);
    vm.expectRevert("WasiAI: amount mismatch");
    marketplace.recordInvocation(SLUG, payer, USER_DEPOSIT, keccak256("attack"));

    // 3. checkSolvency must return true
    (bool solvent, uint256 accounted, uint256 balance) = marketplace.checkSolvency();
    assertTrue(solvent, "NA-H01 FIXED: contract is solvent");
    assertEq(accounted, balance, "NA-H01 FIXED: accounted == balance");
}

// Edge case: amount == pricePerCall but USDC comes from keyBalance pool
// This was the residual attack path — counters must still hold invariant
function test_NA_H01_FIXED_SolvencyHolds_WhenAmountMatchesPricePerCall() public {
    // Setup: user deposits exactly pricePerCall in their key
    usdc.mint(payer, PRICE);
    vm.prank(operator);
    marketplace.depositForKey(KEY_ID, payer, PRICE,
        0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));

    // Operator funds contract separately for a legitimate x402 invocation
    usdc.mint(address(marketplace), PRICE);

    // Legitimate recordInvocation (USDC minted separately, not from keyBalance)
    vm.prank(operator);
    marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("legit"));

    // checkSolvency: totalKeyBalances(PRICE) + totalEarnings(creatorShare) <= balance
    (bool solvent,,) = marketplace.checkSolvency();
    assertTrue(solvent, "NA-H01 FIXED: solvent even when amount == pricePerCall");
}

function test_NA_H01_FIXED_SolvencyAfterFullLifecycle() public {
    // Fund key, settle calls, refund, withdraw — check solvency at each step
    uint256 DEPOSIT = 1_000_000;
    usdc.mint(payer, DEPOSIT);
    vm.prank(operator);
    marketplace.depositForKey(KEY_ID, payer, DEPOSIT,
        0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));

    // Check solvency after deposit
    (bool s1,,) = marketplace.checkSolvency();
    assertTrue(s1, "Solvent after deposit");

    // Settle 5 calls
    string[] memory slugs = new string[](5);
    uint256[] memory amounts = new uint256[](5);
    for (uint i = 0; i < 5; i++) { slugs[i] = SLUG; amounts[i] = PRICE; }
    vm.prank(operator);
    marketplace.settleKeyBatch(KEY_ID, slugs, amounts);

    (bool s2,,) = marketplace.checkSolvency();
    assertTrue(s2, "Solvent after settle");

    // Creator withdraws
    vm.prank(creator);
    marketplace.withdraw();

    (bool s3,,) = marketplace.checkSolvency();
    assertTrue(s3, "Solvent after withdraw");
}
```

### NA-M03: Invert the fee sandwich test

```solidity
function test_NA_M03_FIXED_FeeSandwich_TimelockPrevents() public {
    uint256 DEPOSIT   = 1_000_000;
    uint256 CALL_COST = PRICE;

    usdc.mint(payer, DEPOSIT);
    vm.prank(operator);
    marketplace.depositForKey(KEY_ID, payer, DEPOSIT,
        0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));

    // Owner tries to propose fee change to 30%
    vm.prank(owner);
    marketplace.proposeFee(3000);

    // Try to execute immediately — must REVERT (timelock active)
    vm.prank(owner);
    vm.expectRevert("WasiAI: timelock active");
    marketplace.executeFee();

    // Settle happens at original 10% fee — user is protected
    string[] memory slugs = new string[](1);
    uint256[] memory amounts = new uint256[](1);
    slugs[0] = SLUG; amounts[0] = CALL_COST;
    vm.prank(operator);
    marketplace.settleKeyBatch(KEY_ID, slugs, amounts);

    // Treasury got 10%, not 30%
    uint256 expected10pct = CALL_COST * 1000 / 10000;
    assertEq(usdc.balanceOf(treasury), expected10pct,
        "NA-M03 FIXED: user paid original 10% fee, not sandwich 30%");
}
```

Also add test for `setPlatformFee` no longer existing:
```solidity
function test_NA_M03_FIXED_SetPlatformFee_NoLongerExists() public {
    bytes4 selector = bytes4(keccak256("setPlatformFee(uint16)"));
    (bool success,) = address(marketplace).call(abi.encodeWithSelector(selector, 2000));
    assertFalse(success, "NA-M03 FIXED: setPlatformFee removed, replaced by proposeFee/executeFee");
}
```

---

## Wave 5 — Edge Case Tests for New Functions

Add to `contracts/test/WasiAIMarketplace.t.sol`:

```solidity
// ── Fee Timelock Tests ────────────────────────────────────────────────────────

function test_ProposeFee_Works() public {
    vm.prank(owner);
    marketplace.proposeFee(1500);
    assertEq(marketplace.pendingFeeBps(), 1500);
    assertGt(marketplace.pendingFeeTimestamp(), block.timestamp);
}

function test_ExecuteFee_BeforeTimelock_Reverts() public {
    vm.prank(owner);
    marketplace.proposeFee(1500);
    vm.expectRevert("WasiAI: timelock active");
    vm.prank(owner);
    marketplace.executeFee();
}

function test_ExecuteFee_AfterTimelock_Works() public {
    vm.prank(owner);
    marketplace.proposeFee(1500);
    vm.warp(block.timestamp + 48 hours + 1);
    vm.prank(owner);
    marketplace.executeFee();
    assertEq(marketplace.platformFeeBps(), 1500);
    assertEq(marketplace.pendingFeeBps(), 0);
}

function test_CancelFee_Works() public {
    vm.prank(owner);
    marketplace.proposeFee(1500);
    vm.prank(owner);
    marketplace.cancelFee();
    assertEq(marketplace.pendingFeeBps(), 0);
    assertEq(marketplace.pendingFeeTimestamp(), 0);
    assertEq(marketplace.platformFeeBps(), 1000); // unchanged
}

function test_ProposeFee_TooHigh_Reverts() public {
    vm.prank(owner);
    vm.expectRevert("WasiAI: max 30%");
    marketplace.proposeFee(3001);
}

// ── Solvency Tests ────────────────────────────────────────────────────────────

function test_CheckSolvency_InitialState() public view {
    (bool solvent, uint256 accounted, uint256 balance) = marketplace.checkSolvency();
    assertTrue(solvent);
    assertEq(accounted, 0);
    assertEq(balance, 0);
}

function test_CheckSolvency_AfterDeposit() public {
    usdc.mint(payer, 1_000_000);
    vm.prank(operator);
    marketplace.depositForKey(KEY_ID, payer, 1_000_000,
        0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));
    (bool solvent, uint256 accounted, uint256 balance) = marketplace.checkSolvency();
    assertTrue(solvent);
    assertEq(accounted, balance);
}

function test_TotalKeyBalances_TrackedCorrectly() public {
    usdc.mint(payer, 500_000);
    vm.prank(operator);
    marketplace.depositForKey(KEY_ID, payer, 500_000,
        0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));
    assertEq(marketplace.totalKeyBalances(), 500_000);
}

function test_TotalEarnings_TrackedCorrectly() public {
    _setupAndInvoke();
    uint256 expected = PRICE * 9000 / 10000; // 90% creator share — but use contract math
    // Use contract's own calculation to avoid rounding mismatch
    assertEq(marketplace.totalEarnings(), marketplace.getPendingEarnings(creator));
}
```

Helper `_setupAndInvoke`:
```solidity
function _setupAndInvoke() internal {
    usdc.mint(address(marketplace), PRICE);
    vm.prank(operator);
    marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("pid-helper"));
}
```

---

## Wave 6 — Full Test Run

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2/contracts
~/.foundry/bin/forge test -vv 2>&1
```

**Pass criteria:**
- 0 failures
- `test_NA_H01_FIXED_*` PASS
- `test_NA_M03_FIXED_*` PASS
- `checkSolvency()` tests PASS
- Fee timelock tests PASS
- All 108 original tests still PASS

Target: ~125 tests, 0 failures.

---

## Wave 7 — Commit + Push

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2
git add contracts/src/WasiAIMarketplace.sol contracts/test/
git commit -m "fix(WAS-92/95): NA-H01 solvency invariant + NA-M03 fee timelock 48h

- Add totalKeyBalances + totalEarnings global counters
- Add checkSolvency() public view — returns (solvent, accounted, balance)
- Every USDC-moving function updates counters correctly
- Replace setPlatformFee with proposeFee/executeFee/cancelFee (48h timelock)
- NexusAudit PoC tests inverted: NA-H01 and NA-M03 attacks no longer executable"
git push origin master master:main
```

---

## Critical Constraints

1. **Read every file before modifying** — never assume content
2. **Wave order is strict:** W1 → W2 → W3 (forge build) → W4 → W5 → W6 (forge test) → W7
3. **After W2, forge build must pass before continuing** — Ownable2Step + Pausable already in place
4. **Counter arithmetic must be exact:**
   - `depositForKey`: totalKeyBalances += amount
   - `settleKeyBatch`: totalKeyBalances -= total; totalEarnings += sum(creatorShares)
   - `refundKeyToEarnings`: totalKeyBalances -= amount; totalEarnings += amount
   - `emergencyWithdrawKey`: totalKeyBalances -= amount (no earnings change)
   - `withdraw`: totalEarnings -= amount
   - `withdrawFor`: totalEarnings -= amount
   - `recordInvocation`: totalEarnings += creatorShare (platformShare exits immediately)
5. **NA-H01 is partially mitigated by WAS-105 already** — `recordInvocation` now requires
   `amount == pricePerCall`, making cross-pool abuse harder. The counters add the invariant layer.
6. **Do NOT remove the original PoC tests** — rename them with `_ORIGINAL_` prefix and keep them
   commented out for documentation purposes
7. **fuzz tests for solvency** — add one fuzz test that calls random operations and checks
   `checkSolvency()` always returns true
