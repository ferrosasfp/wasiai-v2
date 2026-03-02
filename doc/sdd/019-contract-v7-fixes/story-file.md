# Story File — SDD #019: WasiAI Contract v7 Fixes
**Sprint 9 | WAS-104 to WAS-111 + WAS-112 to WAS-115**
**Source of truth: this file only. Read every file before modifying.**

---

## Context

NexusAudit found 16 findings, 15 confirmed via PoC tests.
This story file fixes 8 of them in `WasiAIMarketplace.sol` and expands the test suite.

Contract path: `contracts/src/WasiAIMarketplace.sol`
Test path: `contracts/test/WasiAIMarketplace.t.sol`
PoC test path: `contracts/test/NexusAuditValidation.t.sol`

---

## Wave 1 — Imports & Inheritance (WAS-107 + WAS-106)

### WAS-107: Ownable → Ownable2Step

**File:** `contracts/src/WasiAIMarketplace.sol`

Replace line 6:
```solidity
// BEFORE:
import "@openzeppelin/contracts/access/Ownable.sol";

// AFTER:
import "@openzeppelin/contracts/access/Ownable2Step.sol";
```

Replace line 53:
```solidity
// BEFORE:
contract WasiAIMarketplace is Ownable, ReentrancyGuard {

// AFTER:
contract WasiAIMarketplace is Ownable2Step, ReentrancyGuard, Pausable {
```

### WAS-106: Add Pausable

Add import after Ownable2Step import:
```solidity
import "@openzeppelin/contracts/utils/Pausable.sol";
```

Add `pause()` and `unpause()` functions in the Admin section:
```solidity
/// @notice Pause deposits and batch settlement. Emergency use only.
function pause() external onlyOwner {
    _pause();
}

/// @notice Unpause the contract.
function unpause() external onlyOwner {
    _unpause();
}
```

Add `whenNotPaused` to `depositForKey` and `settleKeyBatch`:
```solidity
function depositForKey(...) external onlyOperator nonReentrant whenNotPaused {
function settleKeyBatch(...) external onlyOperator nonReentrant whenNotPaused {
```

**Constructor:** `Ownable2Step` constructor — verify it still compiles with `Ownable(msg.sender)`.
Check OpenZeppelin v5: `Ownable2Step` does NOT require a separate constructor call — it inherits from `Ownable`. Keep `Ownable(msg.sender)` in constructor.

---

## Wave 2 — performUpkeep Fix (WAS-104)

**File:** `contracts/src/WasiAIMarketplace.sol`

Find `performUpkeep` function (~line 489). Remove `lastOperatorActivity = block.timestamp`:

```solidity
// BEFORE:
function performUpkeep(bytes calldata /* performData */) external {
    require(
        (block.timestamp - lastUpkeepTimestamp) >= UPKEEP_INTERVAL,
        "WasiAI: upkeep not needed"
    );
    lastUpkeepTimestamp  = block.timestamp;
    lastOperatorActivity = block.timestamp;  // ← REMOVE THIS LINE
    emit UpkeepPerformed(block.timestamp, msg.sender);
}

// AFTER:
function performUpkeep(bytes calldata /* performData */) external {
    require(
        (block.timestamp - lastUpkeepTimestamp) >= UPKEEP_INTERVAL,
        "WasiAI: upkeep not needed"
    );
    lastUpkeepTimestamp = block.timestamp;
    emit UpkeepPerformed(block.timestamp, msg.sender);
}
```

---

## Wave 3 — recordInvocation Amount Validation (WAS-105)

**File:** `contracts/src/WasiAIMarketplace.sol`

Find `recordInvocation` (~line 220). After `require(amount > 0, "WasiAI: zero amount")` add:

```solidity
require(amount == agent.pricePerCall, "WasiAI: amount mismatch");
```

Full context after fix:
```solidity
Agent storage agent = agents[slug];
require(agent.active,  "WasiAI: agent inactive");
require(amount > 0,    "WasiAI: zero amount");
require(amount == agent.pricePerCall, "WasiAI: amount mismatch");  // ← ADD
```

---

## Wave 4 — Small Fixes (WAS-108, WAS-109, WAS-110, WAS-111)

### WAS-108: setOperator zero address check

Find `setOperator` (~line 452):
```solidity
// ADD as first line in function body:
require(operator != address(0), "WasiAI: zero operator");
```

### WAS-109: updateAgent existence check

Find `updateAgent` (~line 191). After `Agent storage agent = agents[slug];` add:
```solidity
require(agent.creator != address(0), "WasiAI: agent not found");
```

### WAS-110: settleKeyBatch size cap

Find `settleKeyBatch` (~line 333). After `require(slugs.length > 0, "WasiAI: empty batch");` add:
```solidity
require(slugs.length <= 500, "WasiAI: batch too large");
```

### WAS-111a: setPlatformFee — state before emit

Find `setPlatformFee` (~line 439):
```solidity
// BEFORE:
emit PlatformFeeUpdated(platformFeeBps, bps);
platformFeeBps = bps;

// AFTER:
uint16 oldBps = platformFeeBps;
platformFeeBps = bps;
emit PlatformFeeUpdated(oldBps, bps);
```

### WAS-111b: Constructor emits PlatformFeeUpdated

Find constructor (~line 144). At the END of the constructor body add:
```solidity
emit PlatformFeeUpdated(0, platformFeeBps);
```

---

## Wave 5 — Compile Check

```bash
cd contracts && forge build 2>&1
```

Must have 0 errors. Warnings are OK.

---

## Wave 6 — Update NexusAudit PoC Tests (Regression Inversion)

**File:** `contracts/test/NexusAuditValidation.t.sol`

The PoC tests currently PASS (attacks work). After fixes, the attacks must FAIL.
Convert each fixed finding's test to expect the attack to REVERT:

### test_NA_M01 — performUpkeep no longer resets lastOperatorActivity
```solidity
// After fix: performUpkeep should NOT reset emergency timer
// Replace vm.expectRevert with: verify emergency exit WORKS after timeout
// The test should now show that emergencyWithdrawKey SUCCEEDS
```

Full new test logic:
```solidity
function test_NA_M01_FIXED_performUpkeep_NoLongerBlocksEmergencyExit() public {
    // Fund key
    usdc.mint(payer, 1_000_000);
    vm.prank(operator);
    marketplace.depositForKey(KEY_ID, payer, 1_000_000, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));

    // Operator disappears — 25 days pass
    vm.warp(block.timestamp + 25 days);

    // Attacker calls performUpkeep — should NOT reset lastOperatorActivity
    vm.warp(block.timestamp + 23 hours + 1);
    vm.prank(attacker);
    marketplace.performUpkeep("");

    // 5 more days — total 30+ days since real operator activity
    vm.warp(block.timestamp + 5 days);

    // Emergency exit should NOW WORK (fix confirmed)
    vm.prank(payer);
    marketplace.emergencyWithdrawKey(KEY_ID);  // must NOT revert
    assertEq(usdc.balanceOf(payer), 1_000_000, "NA-M01 FIXED: user recovered funds");
}
```

### test_NA_H02 — recordInvocation now validates amount
```solidity
function test_NA_H02_FIXED_recordInvocation_RejectsWrongAmount() public {
    usdc.mint(address(marketplace), PRICE * 2);
    vm.prank(operator);
    vm.expectRevert("WasiAI: amount mismatch");
    marketplace.recordInvocation(SLUG, payer, 1, keccak256("pid-fix"));  // 1 != pricePerCall
}
```

### test_NA_M03 — fee sandwich: KEEP original test (no timelock added yet — document as known limitation)

### test_NA_M04 — Ownable2Step: transferOwnership now requires acceptance
```solidity
function test_NA_M04_FIXED_Ownable2Step_RequiresAcceptance() public {
    address newOwner = address(0x999);
    vm.prank(owner);
    marketplace.transferOwnership(newOwner);
    // Ownership not transferred yet — still old owner
    assertEq(marketplace.owner(), owner, "NA-M04 FIXED: owner unchanged until accepted");
    // newOwner must accept
    vm.prank(newOwner);
    marketplace.acceptOwnership();
    assertEq(marketplace.owner(), newOwner, "NA-M04 FIXED: ownership transferred after acceptance");
}
```

### test_NA_M02 — Pausable now exists
```solidity
function test_NA_M02_FIXED_PausableExists() public {
    // pause() should now work
    vm.prank(owner);
    marketplace.pause();
    // depositForKey should revert when paused
    usdc.mint(payer, PRICE);
    vm.prank(operator);
    vm.expectRevert();
    marketplace.depositForKey(KEY_ID, payer, PRICE, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));
}
```

### test_NA_L01 — setOperator rejects zero address
```solidity
function test_NA_L01_FIXED_SetOperator_RejectsZeroAddress() public {
    vm.prank(owner);
    vm.expectRevert("WasiAI: zero operator");
    marketplace.setOperator(address(0), true);
}
```

### test_NA_L02 — updateAgent rejects nonexistent slug
```solidity
function test_NA_L02_FIXED_UpdateAgent_RejectsNonExistentSlug() public {
    vm.prank(owner);
    vm.expectRevert("WasiAI: agent not found");
    marketplace.updateAgent("does-not-exist", 999, true);
}
```

### test_NA_M05 — settleKeyBatch rejects batch > 500
```solidity
function test_NA_M05_FIXED_SettleKeyBatch_RejectsOversizeBatch() public {
    uint256 OVER_CAP = 501;
    usdc.mint(payer, OVER_CAP * 100);
    vm.prank(operator);
    marketplace.depositForKey(KEY_ID, payer, OVER_CAP * 100, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));
    string[]  memory slugs   = new string[](OVER_CAP);
    uint256[] memory amounts = new uint256[](OVER_CAP);
    for (uint i = 0; i < OVER_CAP; i++) { slugs[i] = SLUG; amounts[i] = 100; }
    vm.prank(operator);
    vm.expectRevert("WasiAI: batch too large");
    marketplace.settleKeyBatch(KEY_ID, slugs, amounts);
}
```

### test_NA_L03 + test_NA_L04 — events now in correct order
Keep existing tests — they verify the event EXISTS. They will still pass.
Add a new test verifying state is updated BEFORE the event is emitted.

---

## Wave 7 — Full Test Run

```bash
cd contracts && forge test -vv 2>&1
```

**Pass criteria:**
- All original tests: PASS (63+)
- All NexusAudit PoC (original attacks): should now FAIL with correct revert messages
- All FIXED regression tests: PASS
- 0 compilation errors

---

## Wave 8 — Commit

```bash
git add contracts/src/WasiAIMarketplace.sol contracts/test/NexusAuditValidation.t.sol
git commit -m "fix(WAS-104/105/106/107/108/109/110/111): contract v7 — NexusAudit fixes"
git push origin master master:main
```

---

## Critical Constraints

1. Read EVERY file before modifying — never assume content
2. Wave order is strict: 1 → 2 → 3 → 4 → 5 (compile) → 6 → 7 → 8
3. After Wave 1, run `forge build` to verify Ownable2Step + Pausable compile correctly before continuing
4. `Ownable2Step` in OZ v5: import path is `@openzeppelin/contracts/access/Ownable2Step.sol` — verify it exists in node_modules before using
5. The constructor call `Ownable(msg.sender)` remains valid with Ownable2Step in OZ v5
6. NA-M03 (fee sandwich) is NOT fixed in this sprint — no timelock implemented — keep original PoC test as-is and document as known limitation
7. NA-H01 (insolvency) is NOT fixed in this sprint — architectural, requires v2 design — document as known limitation
