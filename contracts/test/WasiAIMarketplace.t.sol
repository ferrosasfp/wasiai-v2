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
        marketplace.recordInvocation(SLUG, payer, PRICE);

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
        marketplace.recordInvocation(SLUG, payer, PRICE);
        vm.stopPrank();
    }

    // ── Withdrawal ────────────────────────────────────────────────────────────

    function test_Withdraw() public {
        vm.prank(operator);
        marketplace.registerAgent(SLUG, PRICE, creator, 0);
        usdc.mint(address(marketplace), PRICE);

        vm.prank(operator);
        marketplace.recordInvocation(SLUG, payer, PRICE);

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
            marketplace.recordInvocation(SLUG, payer, PRICE);
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
        marketplace.recordInvocation(SLUG, payer, PRICE);

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
}
