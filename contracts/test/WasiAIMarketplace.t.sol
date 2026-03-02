// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/WasiAIMarketplace.sol";

/// @dev Minimal ERC-20 mock with ERC-3009 support for testing
contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        balanceOf[from] -= amount;
        balanceOf[to]   += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    /**
     * @dev ERC-3009 mock: transferWithAuthorization.
     *      In tests, we skip signature verification and just transfer.
     *      The `from` account must have sufficient balance (pre-minted in setUp).
     */
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 /* validAfter */,
        uint256 /* validBefore */,
        bytes32 /* nonce */,
        uint8   /* v */,
        bytes32 /* r */,
        bytes32 /* s */
    ) external {
        require(balanceOf[from] >= value, "MockUSDC: insufficient balance for auth");
        balanceOf[from] -= value;
        balanceOf[to]   += value;
    }
}

contract WasiAIMarketplaceTest is Test {
    WasiAIMarketplace marketplace;
    MockUSDC          usdc;

    address owner    = address(0x1);
    address treasury = address(0x2);
    address creator  = address(0x3);
    address payer    = address(0x4);
    address operator = address(0x5);
    address stranger = address(0x6);

    string constant SLUG  = "gpt-translator";
    string constant SLUG2 = "text-summarizer";
    uint256 constant PRICE = 20_000; // $0.02 USDC (6 decimals)

    function setUp() public {
        vm.startPrank(owner);
        usdc        = new MockUSDC();
        marketplace = new WasiAIMarketplace(address(usdc), treasury);
        marketplace.setOperator(operator, true);
        vm.stopPrank();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _fundKey(bytes32 keyId, address keyOwner, uint256 amount) internal {
        usdc.mint(keyOwner, amount);
        vm.prank(operator);
        marketplace.depositForKey(keyId, keyOwner, amount, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));
    }

    function _registerAgent(string memory slug, address agentCreator) internal {
        vm.prank(operator);
        marketplace.registerAgent(slug, PRICE, agentCreator, 0);
    }

    // ── Registration ──────────────────────────────────────────────────────────

    function test_RegisterAgent() public {
        vm.prank(operator);
        marketplace.registerAgent(SLUG, PRICE, creator, 0);

        WasiAIMarketplace.Agent memory agent = marketplace.getAgent(SLUG);
        assertEq(agent.creator,      creator);
        assertEq(agent.pricePerCall, PRICE);
        assertTrue(agent.active);
    }

    function test_RegisterAgent_SlugTaken() public {
        vm.startPrank(operator);
        marketplace.registerAgent(SLUG, PRICE, creator, 0);

        vm.expectRevert("WasiAI: slug taken");
        marketplace.registerAgent(SLUG, PRICE, creator, 0);
        vm.stopPrank();
    }

    function test_RegisterAgent_OnlyOperator() public {
        vm.prank(payer); // not an operator
        vm.expectRevert("WasiAI: not operator");
        marketplace.registerAgent(SLUG, PRICE, creator, 0);
    }

    function test_RegisterAgent_UpdatesLastActivity() public {
        uint256 before = marketplace.lastOperatorActivity();
        vm.warp(block.timestamp + 100);
        vm.prank(operator);
        marketplace.registerAgent(SLUG, PRICE, creator, 0);
        assertGt(marketplace.lastOperatorActivity(), before);
    }

    // ── Invocation & Split ────────────────────────────────────────────────────

    function test_RecordInvocation_Split() public {
        // Setup
        vm.prank(operator);
        marketplace.registerAgent(SLUG, PRICE, creator, 0);

        // Fund contract with USDC (simulates x402 payment)
        usdc.mint(address(marketplace), PRICE);

        // Record invocation
        vm.prank(operator);
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256(abi.encodePacked(block.number, msg.sender)));

        // Platform gets 10% = 2000 units = $0.002
        assertEq(usdc.balanceOf(treasury), 2_000);

        // Creator gets 90% = 18000 units = $0.018
        assertEq(marketplace.getPendingEarnings(creator), 18_000);

        // Stats updated
        assertEq(marketplace.totalVolume(),      PRICE);
        assertEq(marketplace.totalInvocations(), 1);
    }

    function test_RecordInvocation_InactiveAgent() public {
        vm.startPrank(operator);
        marketplace.registerAgent(SLUG, PRICE, creator, 0);
        marketplace.updateAgent(SLUG, PRICE, false); // pause agent

        usdc.mint(address(marketplace), PRICE);
        vm.expectRevert("WasiAI: agent inactive");
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256(abi.encodePacked(block.number, msg.sender)));
        vm.stopPrank();
    }

    // ── Withdrawal ────────────────────────────────────────────────────────────

    function test_Withdraw() public {
        vm.prank(operator);
        marketplace.registerAgent(SLUG, PRICE, creator, 0);
        usdc.mint(address(marketplace), PRICE);

        vm.prank(operator);
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256(abi.encodePacked(block.number, msg.sender)));

        uint256 pending = marketplace.getPendingEarnings(creator);
        assertEq(pending, 18_000);

        vm.prank(creator);
        marketplace.withdraw();

        assertEq(usdc.balanceOf(creator),            18_000);
        assertEq(marketplace.getPendingEarnings(creator), 0);
    }

    function test_Withdraw_NothingToWithdraw() public {
        vm.prank(creator);
        vm.expectRevert("WasiAI: nothing to withdraw");
        marketplace.withdraw();
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function test_SetPlatformFee() public {
        vm.prank(owner);
        marketplace.setPlatformFee(500); // 5%
        assertEq(marketplace.platformFeeBps(), 500);
    }

    function test_SetPlatformFee_TooHigh() public {
        vm.prank(owner);
        vm.expectRevert("WasiAI: max 30%");
        marketplace.setPlatformFee(3001);
    }

    function test_MultipleInvocations() public {
        vm.prank(operator);
        marketplace.registerAgent(SLUG, PRICE, creator, 0);

        for (uint256 i = 0; i < 5; i++) {
            usdc.mint(address(marketplace), PRICE);
            vm.prank(operator);
            marketplace.recordInvocation(SLUG, payer, PRICE, keccak256(abi.encodePacked(i, SLUG)));
        }

        // 5 calls × $0.02 = $0.10 total
        // Creator: 90% × $0.10 = $0.09 = 90,000 units
        assertEq(marketplace.getPendingEarnings(creator), 90_000);
        assertEq(marketplace.totalInvocations(), 5);
        assertEq(marketplace.totalVolume(), PRICE * 5);
    }

    // ── Pre-funded Key Tests ───────────────────────────────────────────────────

    bytes32 constant KEY_ID = bytes32(uint256(0xDEADBEEF));

    function test_DepositForKey() public {
        // Give user (payer) some USDC to fund their key
        usdc.mint(payer, 1_000_000); // $1.00

        // Operator calls depositForKey on behalf of user
        vm.prank(operator);
        marketplace.depositForKey(
            KEY_ID,
            payer,
            1_000_000,
            0,             // validAfter
            type(uint256).max, // validBefore
            bytes32(0),    // nonce
            0, bytes32(0), bytes32(0) // v, r, s (mock ignores)
        );

        // Check on-chain balance
        assertEq(marketplace.getKeyBalance(KEY_ID), 1_000_000);
        // Check owner registered
        assertEq(marketplace.keyOwners(KEY_ID), payer);
        // Check USDC transferred to contract
        assertEq(usdc.balanceOf(address(marketplace)), 1_000_000);
        assertEq(usdc.balanceOf(payer), 0);
    }

    function test_DepositForKey_OnlyOperator() public {
        usdc.mint(payer, PRICE);
        vm.prank(payer); // not operator
        vm.expectRevert("WasiAI: not operator");
        marketplace.depositForKey(KEY_ID, payer, PRICE, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));
    }

    function test_DepositForKey_ZeroKeyId() public {
        usdc.mint(payer, PRICE);
        vm.prank(operator);
        vm.expectRevert("WasiAI: zero keyId");
        marketplace.depositForKey(bytes32(0), payer, PRICE, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));
    }

    function test_DepositForKey_ZeroAmount() public {
        vm.prank(operator);
        vm.expectRevert("WasiAI: zero amount");
        marketplace.depositForKey(KEY_ID, payer, 0, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));
    }

    function test_DepositForKey_OwnerNotOverwritten() public {
        // First deposit: payer becomes owner
        usdc.mint(payer, 2_000_000);
        vm.prank(operator);
        marketplace.depositForKey(KEY_ID, payer, 1_000_000, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));

        // Second deposit (top-up): owner should not change
        vm.prank(operator);
        marketplace.depositForKey(KEY_ID, payer, 1_000_000, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));

        assertEq(marketplace.keyOwners(KEY_ID), payer);
        assertEq(marketplace.getKeyBalance(KEY_ID), 2_000_000);
    }

    function test_DepositForKey_UpdatesLastActivity() public {
        usdc.mint(payer, PRICE);
        uint256 before = marketplace.lastOperatorActivity();
        vm.warp(block.timestamp + 50);
        vm.prank(operator);
        marketplace.depositForKey(KEY_ID, payer, PRICE, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));
        assertGt(marketplace.lastOperatorActivity(), before);
    }

    // ── settleKeyBatch Tests ───────────────────────────────────────────────────

    function test_SettleKeyBatch_Split() public {
        // Register two agents
        _registerAgent(SLUG,  creator);
        _registerAgent(SLUG2, creator);

        // Fund key with $1.00
        _fundKey(KEY_ID, payer, 1_000_000);

        string[] memory slugs   = new string[](2);
        uint256[] memory amounts = new uint256[](2);
        slugs[0]   = SLUG;   amounts[0] = 20_000; // $0.02
        slugs[1]   = SLUG2;  amounts[1] = 10_000; // $0.01

        vm.prank(operator);
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);

        // Key balance: 1_000_000 - 30_000 = 970_000
        assertEq(marketplace.getKeyBalance(KEY_ID), 970_000);

        // Total platform share = 10% of 30_000 = 3_000
        assertEq(usdc.balanceOf(treasury), 3_000);

        // Creator earnings: 90% of 30_000 = 27_000
        assertEq(marketplace.getPendingEarnings(creator), 27_000);

        // Stats
        assertEq(marketplace.totalVolume(),      30_000);
        assertEq(marketplace.totalInvocations(), 2);
    }

    function test_SettleKeyBatch_CorrectPerItemSplit() public {
        // Register agent with a second creator to test per-item split
        address creator2 = address(0x10);
        _registerAgent(SLUG,  creator);
        vm.prank(operator);
        marketplace.registerAgent(SLUG2, PRICE, creator2, 0);

        _fundKey(KEY_ID, payer, 1_000_000);

        string[] memory slugs   = new string[](2);
        uint256[] memory amounts = new uint256[](2);
        slugs[0]   = SLUG;   amounts[0] = 100_000; // $0.10
        slugs[1]   = SLUG2;  amounts[1] = 50_000;  // $0.05

        vm.prank(operator);
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);

        // creator1: 90% of 100_000 = 90_000
        assertEq(marketplace.getPendingEarnings(creator),  90_000);
        // creator2: 90% of 50_000 = 45_000
        assertEq(marketplace.getPendingEarnings(creator2), 45_000);

        // treasury: 10% of (100_000 + 50_000) = 15_000
        assertEq(usdc.balanceOf(treasury), 15_000);
    }

    function test_SettleKeyBatch_InsufficientBalance() public {
        _registerAgent(SLUG, creator);
        _fundKey(KEY_ID, payer, 10_000); // $0.01 only

        string[] memory slugs   = new string[](1);
        uint256[] memory amounts = new uint256[](1);
        slugs[0]   = SLUG;
        amounts[0] = 20_000; // $0.02 — more than funded

        vm.prank(operator);
        vm.expectRevert("WasiAI: insufficient key balance");
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);
    }

    function test_SettleKeyBatch_LengthMismatch() public {
        _fundKey(KEY_ID, payer, 100_000);

        string[] memory slugs   = new string[](2);
        uint256[] memory amounts = new uint256[](1); // mismatched
        slugs[0]   = SLUG;
        slugs[1]   = SLUG2;
        amounts[0] = 20_000;

        vm.prank(operator);
        vm.expectRevert("WasiAI: length mismatch");
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);
    }

    function test_SettleKeyBatch_EmptyBatch() public {
        _fundKey(KEY_ID, payer, 100_000);

        string[] memory slugs   = new string[](0);
        uint256[] memory amounts = new uint256[](0);

        vm.prank(operator);
        vm.expectRevert("WasiAI: empty batch");
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);
    }

    function test_SettleKeyBatch_ZeroAmount() public {
        _registerAgent(SLUG, creator);
        _fundKey(KEY_ID, payer, 100_000);

        string[] memory slugs   = new string[](1);
        uint256[] memory amounts = new uint256[](1);
        slugs[0]   = SLUG;
        amounts[0] = 0; // zero amount — should revert

        vm.prank(operator);
        vm.expectRevert("WasiAI: zero amount");
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);
    }

    function test_SettleKeyBatch_InactiveAgent() public {
        _registerAgent(SLUG, creator);
        vm.prank(operator);
        marketplace.updateAgent(SLUG, PRICE, false); // pause

        _fundKey(KEY_ID, payer, 100_000);

        string[] memory slugs   = new string[](1);
        uint256[] memory amounts = new uint256[](1);
        slugs[0]   = SLUG;
        amounts[0] = 20_000;

        vm.prank(operator);
        vm.expectRevert("WasiAI: agent inactive");
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);
    }

    function test_SettleKeyBatch_OnlyOperator() public {
        _registerAgent(SLUG, creator);
        _fundKey(KEY_ID, payer, 100_000);

        string[] memory slugs   = new string[](1);
        uint256[] memory amounts = new uint256[](1);
        slugs[0]   = SLUG;
        amounts[0] = 20_000;

        vm.prank(stranger);
        vm.expectRevert("WasiAI: not operator");
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);
    }

    function test_SettleKeyBatch_UpdatesLastActivity() public {
        _registerAgent(SLUG, creator);
        _fundKey(KEY_ID, payer, 100_000);

        uint256 before = marketplace.lastOperatorActivity();
        vm.warp(block.timestamp + 100);

        string[] memory slugs   = new string[](1);
        uint256[] memory amounts = new uint256[](1);
        slugs[0]   = SLUG;
        amounts[0] = 20_000;

        vm.prank(operator);
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);
        assertGt(marketplace.lastOperatorActivity(), before);
    }

    function test_SettleKeyBatch_LargeBatch() public {
        _registerAgent(SLUG, creator);
        uint256 batchSize = 50;
        uint256 perCall   = 1_000; // $0.001
        _fundKey(KEY_ID, payer, batchSize * perCall);

        string[] memory slugs   = new string[](batchSize);
        uint256[] memory amounts = new uint256[](batchSize);
        for (uint256 i = 0; i < batchSize; i++) {
            slugs[i]   = SLUG;
            amounts[i] = perCall;
        }

        vm.prank(operator);
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts); // must not OOG

        assertEq(marketplace.getKeyBalance(KEY_ID),   0);
        assertEq(marketplace.totalInvocations(), batchSize);
        assertEq(marketplace.totalVolume(), batchSize * perCall);
    }

    function test_SettleKeyBatch_TotalVolumeAndInvocations() public {
        _registerAgent(SLUG, creator);
        _fundKey(KEY_ID, payer, 1_000_000);

        string[] memory slugs   = new string[](3);
        uint256[] memory amounts = new uint256[](3);
        for (uint256 i = 0; i < 3; i++) {
            slugs[i]   = SLUG;
            amounts[i] = 10_000;
        }

        vm.prank(operator);
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);

        assertEq(marketplace.totalVolume(),      30_000);
        assertEq(marketplace.totalInvocations(), 3);
    }

    // ── refundKeyToEarnings Tests ─────────────────────────────────────────────

    function test_RefundKeyToEarnings() public {
        _fundKey(KEY_ID, payer, 1_000_000);

        vm.prank(operator);
        marketplace.refundKeyToEarnings(KEY_ID);

        // Key balance zeroed
        assertEq(marketplace.getKeyBalance(KEY_ID), 0);
        // Earnings of payer increased
        assertEq(marketplace.getPendingEarnings(payer), 1_000_000);
    }

    function test_RefundKeyToEarnings_OwnerCanWithdraw() public {
        _fundKey(KEY_ID, payer, 500_000);

        vm.prank(operator);
        marketplace.refundKeyToEarnings(KEY_ID);

        // Payer withdraws their earnings
        vm.prank(payer);
        marketplace.withdraw();

        assertEq(usdc.balanceOf(payer), 500_000);
        assertEq(marketplace.getPendingEarnings(payer), 0);
    }

    function test_RefundKeyToEarnings_UnknownKey() public {
        bytes32 unknownKey = bytes32(uint256(0xCAFEBABE));

        vm.prank(operator);
        vm.expectRevert("WasiAI: unknown key");
        marketplace.refundKeyToEarnings(unknownKey);
    }

    function test_RefundKeyToEarnings_NothingToRefund() public {
        // Fund then settle everything
        _registerAgent(SLUG, creator);
        _fundKey(KEY_ID, payer, PRICE);

        string[] memory slugs   = new string[](1);
        uint256[] memory amounts = new uint256[](1);
        slugs[0]   = SLUG;
        amounts[0] = PRICE;

        vm.prank(operator);
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);

        // Balance is now 0
        vm.prank(operator);
        vm.expectRevert("WasiAI: nothing to refund");
        marketplace.refundKeyToEarnings(KEY_ID);
    }

    function test_RefundKeyToEarnings_OnlyOperator() public {
        _fundKey(KEY_ID, payer, 100_000);

        vm.prank(stranger);
        vm.expectRevert("WasiAI: not operator");
        marketplace.refundKeyToEarnings(KEY_ID);
    }

    function test_RefundKeyToEarnings_UpdatesLastActivity() public {
        _fundKey(KEY_ID, payer, 100_000);
        uint256 before = marketplace.lastOperatorActivity();
        vm.warp(block.timestamp + 100);

        vm.prank(operator);
        marketplace.refundKeyToEarnings(KEY_ID);
        assertGt(marketplace.lastOperatorActivity(), before);
    }

    // ── emergencyWithdrawKey Tests ────────────────────────────────────────────

    function test_EmergencyWithdrawKey_OperatorStillActive() public {
        _fundKey(KEY_ID, payer, 100_000);

        // Try emergency withdraw — operator just deposited so it's recent
        vm.prank(payer);
        vm.expectRevert("WasiAI: operator still active");
        marketplace.emergencyWithdrawKey(KEY_ID);
    }

    function test_EmergencyWithdrawKey_Success() public {
        _fundKey(KEY_ID, payer, 100_000);

        // Warp past EMERGENCY_TIMEOUT (30 days + 1 second)
        vm.warp(block.timestamp + 30 days + 1);

        uint256 balanceBefore = usdc.balanceOf(payer);

        vm.prank(payer);
        marketplace.emergencyWithdrawKey(KEY_ID);

        assertEq(usdc.balanceOf(payer),         balanceBefore + 100_000);
        assertEq(marketplace.getKeyBalance(KEY_ID), 0);
    }

    function test_EmergencyWithdrawKey_NotOwner() public {
        _fundKey(KEY_ID, payer, 100_000);
        vm.warp(block.timestamp + 31 days);

        vm.prank(stranger);
        vm.expectRevert("WasiAI: not key owner");
        marketplace.emergencyWithdrawKey(KEY_ID);
    }

    function test_EmergencyWithdrawKey_NothingToWithdraw() public {
        // Fund then completely drain
        _registerAgent(SLUG, creator);
        _fundKey(KEY_ID, payer, PRICE);

        string[] memory slugs   = new string[](1);
        uint256[] memory amounts = new uint256[](1);
        slugs[0]   = SLUG;
        amounts[0] = PRICE;

        vm.prank(operator);
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);

        // Warp past timeout
        vm.warp(block.timestamp + 31 days);

        vm.prank(payer);
        vm.expectRevert("WasiAI: nothing to withdraw");
        marketplace.emergencyWithdrawKey(KEY_ID);
    }

    function test_EmergencyWithdrawKey_ExactlyAtTimeout_Reverts() public {
        _fundKey(KEY_ID, payer, 100_000);
        // Warp to exactly lastOperatorActivity + 30 days — NOT past it
        vm.warp(marketplace.lastOperatorActivity() + 30 days);

        vm.prank(payer);
        vm.expectRevert("WasiAI: operator still active");
        marketplace.emergencyWithdrawKey(KEY_ID);
    }

    function test_EmergencyWithdrawKey_ActivityResetPreventsExit() public {
        _fundKey(KEY_ID, payer, 100_000);
        vm.warp(block.timestamp + 29 days);

        // Operator does something → resets timer
        _registerAgent(SLUG, creator);

        // Warp another 2 days (total 31 from start, but only 2 from last activity)
        vm.warp(block.timestamp + 2 days);

        vm.prank(payer);
        vm.expectRevert("WasiAI: operator still active");
        marketplace.emergencyWithdrawKey(KEY_ID);
    }

    // ── lastOperatorActivity tracking ─────────────────────────────────────────

    function test_LastOperatorActivity_SetOnConstruction() public view {
        // Constructor sets it to block.timestamp
        assertGt(marketplace.lastOperatorActivity(), 0);
    }

    function test_LastOperatorActivity_UpdatedOnWithdrawFor() public {
        // Setup earnings for creator
        _registerAgent(SLUG, creator);
        usdc.mint(address(marketplace), PRICE);
        vm.prank(operator);
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256(abi.encodePacked(block.number, msg.sender)));

        uint256 before = marketplace.lastOperatorActivity();
        vm.warp(block.timestamp + 200);

        vm.prank(operator);
        marketplace.withdrawFor(creator);
        assertGt(marketplace.lastOperatorActivity(), before);
    }

    // ── Legacy settleKeyCall removed — verify it doesn't compile ──────────────
    // (The function was intentionally removed from the contract)

    // ── GetKeyBalance ─────────────────────────────────────────────────────────

    function test_GetKeyBalance_Empty() public view {
        assertEq(marketplace.getKeyBalance(KEY_ID), 0);
    }

    // ─── Chainlink Automation tests ───────────────────────────────────────────

    function testCheckUpkeepFalseBeforeInterval() public {
        // Recién desplegado — lastUpkeepTimestamp = block.timestamp
        // No han pasado 23h → upkeepNeeded debe ser false
        (bool upkeepNeeded, ) = marketplace.checkUpkeep("");
        assertFalse(upkeepNeeded, "Should not need upkeep before interval");
    }

    function testCheckUpkeepTrueAfterInterval() public {
        // Avanzar el tiempo 23h + 1 segundo
        vm.warp(block.timestamp + 23 hours + 1);
        (bool upkeepNeeded, ) = marketplace.checkUpkeep("");
        assertTrue(upkeepNeeded, "Should need upkeep after interval");
    }

    function testPerformUpkeepUpdatesTimestamp() public {
        vm.warp(block.timestamp + 23 hours + 1);
        uint256 before = marketplace.lastUpkeepTimestamp();
        marketplace.performUpkeep("");
        assertGt(marketplace.lastUpkeepTimestamp(), before, "Timestamp should update");
    }

    function testPerformUpkeepRevertsBeforeInterval() public {
        vm.expectRevert("WasiAI: upkeep not needed");
        marketplace.performUpkeep("");
    }

    // ── Edge Cases ────────────────────────────────────────────────────────────────

    // Fee edge cases

    function test_EdgeCase_ZeroFee_CreatorGetsAll() public {
        vm.prank(owner);
        marketplace.setPlatformFee(0);

        _registerAgent(SLUG, creator);
        usdc.mint(address(marketplace), PRICE);
        vm.prank(operator);
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("pid-zero-fee"));

        assertEq(marketplace.getPendingEarnings(creator), PRICE);
        assertEq(usdc.balanceOf(treasury), 0);
    }

    function test_EdgeCase_MaxFee_Treasury30pct() public {
        vm.prank(owner);
        marketplace.setPlatformFee(3000);

        _registerAgent(SLUG, creator);
        usdc.mint(address(marketplace), PRICE);
        vm.prank(operator);
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("pid-max-fee"));

        uint256 expectedTreasury = PRICE * 3000 / 10000;
        assertEq(usdc.balanceOf(treasury), expectedTreasury);
        assertEq(marketplace.getPendingEarnings(creator), PRICE - expectedTreasury);
    }

    function test_EdgeCase_FeeAboveMax_Reverts() public {
        vm.prank(owner);
        vm.expectRevert("WasiAI: max 30%");
        marketplace.setPlatformFee(3001);
    }

    // Batch edge cases

    function test_EdgeCase_BatchSize1() public {
        _registerAgent(SLUG, creator);
        _fundKey(KEY_ID, payer, PRICE);

        string[]  memory slugs   = new string[](1);
        uint256[] memory amounts = new uint256[](1);
        slugs[0]   = SLUG;
        amounts[0] = PRICE;

        vm.prank(operator);
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);

        assertEq(marketplace.totalInvocations(), 1);
        assertEq(marketplace.getKeyBalance(KEY_ID), 0);
    }

    function test_EdgeCase_BatchSize500() public {
        _registerAgent(SLUG, creator);
        uint256 perCall   = 1_000;
        uint256 batchSize = 500;
        _fundKey(KEY_ID, payer, batchSize * perCall);

        string[]  memory slugs   = new string[](batchSize);
        uint256[] memory amounts = new uint256[](batchSize);
        for (uint256 i = 0; i < batchSize; i++) {
            slugs[i]   = SLUG;
            amounts[i] = perCall;
        }

        vm.prank(operator);
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);

        assertEq(marketplace.totalInvocations(), batchSize);
        assertEq(marketplace.getKeyBalance(KEY_ID), 0);
    }

    // Amount edge cases

    function test_EdgeCase_AmountOne_Reverts() public {
        _registerAgent(SLUG, creator);
        usdc.mint(address(marketplace), 1);
        vm.prank(operator);
        vm.expectRevert("WasiAI: amount mismatch");
        marketplace.recordInvocation(SLUG, payer, 1, keccak256("pid-one"));
    }

    function test_EdgeCase_AmountExact_Works() public {
        _registerAgent(SLUG, creator);
        usdc.mint(address(marketplace), PRICE);
        vm.prank(operator);
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("pid-exact"));
        assertGt(marketplace.getPendingEarnings(creator), 0);
    }

    function test_EdgeCase_RecordInvocation_ZeroAmount_Reverts() public {
        _registerAgent(SLUG, creator);
        vm.prank(operator);
        vm.expectRevert("WasiAI: zero amount");
        marketplace.recordInvocation(SLUG, payer, 0, keccak256("pid-zero"));
    }

    // Earnings isolation

    function test_EdgeCase_EarningsIsolation_TwoCreators() public {
        address creator2 = address(0xAA);
        _registerAgent(SLUG, creator);
        vm.prank(operator);
        marketplace.registerAgent(SLUG2, PRICE, creator2, 0);

        usdc.mint(address(marketplace), PRICE * 3);

        vm.startPrank(operator);
        marketplace.recordInvocation(SLUG,  payer, PRICE, keccak256("p1"));
        marketplace.recordInvocation(SLUG,  payer, PRICE, keccak256("p2"));
        marketplace.recordInvocation(SLUG2, payer, PRICE, keccak256("p3"));
        vm.stopPrank();

        uint256 fee    = PRICE * 1000 / 10000;
        uint256 share1 = (PRICE - fee) * 2;
        uint256 share2 =  PRICE - fee;

        assertEq(marketplace.getPendingEarnings(creator),  share1);
        assertEq(marketplace.getPendingEarnings(creator2), share2);
    }

    // Pause edge cases (WAS-106)

    function test_EdgeCase_DepositWhenPaused_Reverts() public {
        vm.prank(owner);
        marketplace.pause();

        usdc.mint(payer, PRICE);
        vm.prank(operator);
        vm.expectRevert();
        marketplace.depositForKey(KEY_ID, payer, PRICE, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));
    }

    function test_EdgeCase_SettleWhenPaused_Reverts() public {
        _registerAgent(SLUG, creator);
        _fundKey(KEY_ID, payer, PRICE);

        vm.prank(owner);
        marketplace.pause();

        string[]  memory slugs   = new string[](1);
        uint256[] memory amounts = new uint256[](1);
        slugs[0]   = SLUG;
        amounts[0] = PRICE;

        vm.prank(operator);
        vm.expectRevert();
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);
    }

    function test_EdgeCase_WithdrawWhenPaused_Works() public {
        _registerAgent(SLUG, creator);
        usdc.mint(address(marketplace), PRICE);
        vm.prank(operator);
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("pid-pause-withdraw"));

        vm.prank(owner);
        marketplace.pause();

        // withdraw() has no whenNotPaused — pull pattern preserved
        uint256 pending = marketplace.getPendingEarnings(creator);
        vm.prank(creator);
        marketplace.withdraw();

        assertEq(usdc.balanceOf(creator), pending);
        assertEq(marketplace.getPendingEarnings(creator), 0);
    }

    function test_EdgeCase_UnpauseRestoresOperation() public {
        vm.prank(owner);
        marketplace.pause();

        vm.prank(owner);
        marketplace.unpause();

        // depositForKey should work again
        usdc.mint(payer, PRICE);
        vm.prank(operator);
        marketplace.depositForKey(KEY_ID, payer, PRICE, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));
        assertEq(marketplace.getKeyBalance(KEY_ID), PRICE);
    }

    function test_EdgeCase_PauseOnlyOwner_Reverts() public {
        vm.prank(stranger);
        vm.expectRevert();
        marketplace.pause();
    }

    function test_EdgeCase_UnpauseOnlyOwner_Reverts() public {
        vm.prank(owner);
        marketplace.pause();

        vm.prank(stranger);
        vm.expectRevert();
        marketplace.unpause();
    }

    // Payment ID idempotency

    function test_EdgeCase_DuplicatePaymentId_Reverts() public {
        _registerAgent(SLUG, creator);
        bytes32 pid = keccak256("duplicate-payment");

        usdc.mint(address(marketplace), PRICE * 2);
        vm.startPrank(operator);
        marketplace.recordInvocation(SLUG, payer, PRICE, pid);
        vm.expectRevert("WasiAI: payment already recorded");
        marketplace.recordInvocation(SLUG, payer, PRICE, pid);
        vm.stopPrank();
    }

    // Unknown agent

    function test_EdgeCase_RecordInvocation_UnknownAgent_Reverts() public {
        usdc.mint(address(marketplace), PRICE);
        vm.prank(operator);
        vm.expectRevert("WasiAI: agent inactive");
        marketplace.recordInvocation("nonexistent-agent", payer, PRICE, keccak256("pid-unknown"));
    }

    // Admin edge cases

    function test_EdgeCase_SetTreasury_ZeroAddress_Reverts() public {
        vm.prank(owner);
        vm.expectRevert("WasiAI: zero treasury");
        marketplace.setTreasury(address(0));
    }

    function test_EdgeCase_SetTreasury_Success() public {
        address newTreasury = address(0xBB);
        vm.prank(owner);
        marketplace.setTreasury(newTreasury);
        assertEq(marketplace.treasury(), newTreasury);
    }

    function test_EdgeCase_SetOperator_ZeroAddress_Reverts() public {
        vm.prank(owner);
        vm.expectRevert("WasiAI: zero operator");
        marketplace.setOperator(address(0), true);
    }

    function test_EdgeCase_GetStats() public {
        _registerAgent(SLUG, creator);
        usdc.mint(address(marketplace), PRICE * 2);
        vm.prank(operator);
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("s1"));
        vm.prank(operator);
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("s2"));

        (uint256 volume, uint256 invocations, uint16 feeBps) = marketplace.getStats();
        assertEq(volume,      PRICE * 2);
        assertEq(invocations, 2);
        assertEq(feeBps,      1000);
    }

    // Emergency withdraw when contract is paused — should still work

    function test_EdgeCase_EmergencyWithdraw_WhenContractPaused() public {
        _fundKey(KEY_ID, payer, 100_000);

        vm.prank(owner);
        marketplace.pause();

        vm.warp(block.timestamp + 30 days + 1);

        vm.prank(payer);
        marketplace.emergencyWithdrawKey(KEY_ID); // must NOT revert

        assertEq(marketplace.getKeyBalance(KEY_ID), 0);
        assertEq(usdc.balanceOf(payer), 100_000);
    }

    // Multiple creators withdraw independently

    function test_EdgeCase_MultipleWithdrawals() public {
        address creator2 = address(0xCC);
        _registerAgent(SLUG,  creator);
        vm.prank(operator);
        marketplace.registerAgent(SLUG2, PRICE, creator2, 0);

        usdc.mint(address(marketplace), PRICE * 2);
        vm.prank(operator);
        marketplace.recordInvocation(SLUG,  payer, PRICE, keccak256("mw1"));
        vm.prank(operator);
        marketplace.recordInvocation(SLUG2, payer, PRICE, keccak256("mw2"));

        uint256 e1 = marketplace.getPendingEarnings(creator);
        uint256 e2 = marketplace.getPendingEarnings(creator2);

        vm.prank(creator);
        marketplace.withdraw();
        vm.prank(creator2);
        marketplace.withdraw();

        assertEq(usdc.balanceOf(creator),  e1);
        assertEq(usdc.balanceOf(creator2), e2);
        assertEq(marketplace.getPendingEarnings(creator),  0);
        assertEq(marketplace.getPendingEarnings(creator2), 0);
    }

    // ── Fuzz Tests ────────────────────────────────────────────────────────────────

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

    function testFuzz_SettleKeyBatch_SizeCap(uint16 size) public {
        vm.assume(size > 500 && size <= 600);
        _registerAgent(SLUG, creator);
        _fundKey(KEY_ID, payer, uint256(size) * PRICE);

        string[]  memory slugs   = new string[](size);
        uint256[] memory amounts = new uint256[](size);
        for (uint256 i = 0; i < size; i++) {
            slugs[i]   = SLUG;
            amounts[i] = PRICE;
        }

        vm.prank(operator);
        vm.expectRevert("WasiAI: batch too large");
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);
    }

    function testFuzz_RecordInvocation_AmountMismatch(uint256 amount) public {
        vm.assume(amount > 0 && amount != PRICE);
        _registerAgent(SLUG, creator);
        usdc.mint(address(marketplace), amount);
        vm.prank(operator);
        vm.expectRevert("WasiAI: amount mismatch");
        marketplace.recordInvocation(SLUG, payer, amount, keccak256(abi.encode(amount)));
    }

    // ── Integration Flows ─────────────────────────────────────────────────────────

    // Full Flow A: deposit → multiple settles → refund → withdraw
    function test_Integration_FullKeyLifecycle() public {
        _registerAgent(SLUG, creator);

        // 1. User funds key with $5.00 (5_000_000 = 5 USDC in 6 decimals)
        uint256 keyFund = 5_000_000;
        _fundKey(KEY_ID, payer, keyFund);
        assertEq(marketplace.getKeyBalance(KEY_ID), keyFund);

        // 2. 10 calls settled ($0.10 each = $1.00 total)
        uint256 perCall = 100_000; // $0.10
        string[]  memory slugs   = new string[](10);
        uint256[] memory amounts = new uint256[](10);
        for (uint256 i = 0; i < 10; i++) {
            slugs[i]   = SLUG;
            amounts[i] = perCall;
        }
        vm.prank(operator);
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);

        uint256 spent = perCall * 10; // 1_000_000
        assertEq(marketplace.getKeyBalance(KEY_ID), keyFund - spent);

        // 3. Remaining $4.00 refunded to payer earnings
        vm.prank(operator);
        marketplace.refundKeyToEarnings(KEY_ID);
        assertEq(marketplace.getKeyBalance(KEY_ID), 0);
        assertEq(marketplace.getPendingEarnings(payer), keyFund - spent);

        // 4. Payer withdraws all earnings
        uint256 payerEarnings = marketplace.getPendingEarnings(payer);
        vm.prank(payer);
        marketplace.withdraw();

        // 5. Assert final state
        assertEq(marketplace.getPendingEarnings(payer), 0);
        assertEq(usdc.balanceOf(payer), payerEarnings);
    }

    // Full Flow B: x402 direct → multiple invocations → creator withdraw
    function test_Integration_DirectPaymentFlow() public {
        _registerAgent(SLUG, creator);

        uint256 n = 5;
        usdc.mint(address(marketplace), PRICE * n);

        vm.startPrank(operator);
        for (uint256 i = 0; i < n; i++) {
            marketplace.recordInvocation(SLUG, payer, PRICE, keccak256(abi.encode("dp", i)));
        }
        vm.stopPrank();

        uint256 totalFee      = (PRICE * 1000 / 10000) * n;
        uint256 creatorEarned = PRICE * n - totalFee;

        assertEq(usdc.balanceOf(treasury), totalFee);
        assertEq(marketplace.getPendingEarnings(creator), creatorEarned);

        vm.prank(creator);
        marketplace.withdraw();

        assertEq(usdc.balanceOf(creator), creatorEarned);
        assertEq(marketplace.getPendingEarnings(creator), 0);
    }

    // Full Flow C: Pause → pending operations → unpause → resume
    function test_Integration_PauseResumeCycle() public {
        _registerAgent(SLUG, creator);

        // 1. Fund key before pause
        _fundKey(KEY_ID, payer, 1_000_000);

        // 2. Pause contract
        vm.prank(owner);
        marketplace.pause();

        // 3. Try depositForKey → revert
        usdc.mint(payer, PRICE);
        vm.prank(operator);
        vm.expectRevert();
        marketplace.depositForKey(KEY_ID, payer, PRICE, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));

        // 4. Try settleKeyBatch → revert
        string[]  memory slugs   = new string[](1);
        uint256[] memory amounts = new uint256[](1);
        slugs[0]   = SLUG;
        amounts[0] = PRICE;
        vm.prank(operator);
        vm.expectRevert();
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);

        // 5. withdraw() still works — pull pattern preserved
        // Give creator some earnings first (recordInvocation has no whenNotPaused)
        usdc.mint(address(marketplace), PRICE);
        vm.prank(operator);
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("prc1"));
        uint256 pending = marketplace.getPendingEarnings(creator);
        assertGt(pending, 0);
        vm.prank(creator);
        marketplace.withdraw();
        assertEq(marketplace.getPendingEarnings(creator), 0);

        // 6. Unpause
        vm.prank(owner);
        marketplace.unpause();

        // 7. depositForKey works again
        vm.prank(operator);
        marketplace.depositForKey(
            bytes32(uint256(KEY_ID) + 1), payer, PRICE,
            0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0)
        );
        assertEq(marketplace.getKeyBalance(bytes32(uint256(KEY_ID) + 1)), PRICE);
    }

    // Full Flow D: Emergency exit after operator inactivity
    function test_Integration_EmergencyExitFlow() public {
        // 1. Fund key
        _fundKey(KEY_ID, payer, 100_000);
        uint256 funded = 100_000;

        // 2. 30 days + 1 second pass with no operator activity
        vm.warp(block.timestamp + 30 days + 1);

        // 3. performUpkeep called by attacker — must NOT update lastOperatorActivity (v7 fix)
        marketplace.performUpkeep("");
        uint256 activityAfterUpkeep = marketplace.lastOperatorActivity();
        // lastOperatorActivity should NOT have changed due to performUpkeep
        assertTrue(
            block.timestamp > activityAfterUpkeep + 30 days,
            "performUpkeep must not reset lastOperatorActivity"
        );

        // 4. emergencyWithdrawKey succeeds
        vm.prank(payer);
        marketplace.emergencyWithdrawKey(KEY_ID);

        assertEq(marketplace.getKeyBalance(KEY_ID), 0);
        assertEq(usdc.balanceOf(payer), funded);
    }
}
