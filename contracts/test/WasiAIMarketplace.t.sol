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

    // ── Self-Registration (WAS-160g) ────────────────────────────────────────────

    function test_SelfRegisterAgent() public {
        vm.prank(creator);
        marketplace.selfRegisterAgent(SLUG, PRICE, 0);

        WasiAIMarketplace.Agent memory agent = marketplace.getAgent(SLUG);
        assertEq(agent.creator,      creator);
        assertEq(agent.pricePerCall, PRICE);
        assertEq(agent.erc8004Id,    0);
    }

    function test_SelfRegisterAgent_SlugTaken() public {
        vm.prank(creator);
        marketplace.selfRegisterAgent(SLUG, PRICE, 0);

        vm.prank(stranger);
        vm.expectRevert("WasiAI: slug taken");
        marketplace.selfRegisterAgent(SLUG, PRICE, 0);
    }

    function test_SelfRegisterAgent_EmptySlug() public {
        vm.prank(creator);
        vm.expectRevert("Invalid slug length");
        marketplace.selfRegisterAgent("", PRICE, 0);
    }

    function test_SelfRegisterAgent_WhenPaused() public {
        vm.prank(owner);
        marketplace.pause();

        vm.prank(creator);
        vm.expectRevert();
        marketplace.selfRegisterAgent(SLUG, PRICE, 0);
    }

    function test_SelfRegisterAgent_EmitsEvent() public {
        vm.prank(creator);
        vm.expectEmit(true, true, true, true);
        emit WasiAIMarketplace.AgentRegistered(SLUG, creator, PRICE, 0);
        marketplace.selfRegisterAgent(SLUG, PRICE, 0);
    }

    // ── Self-Registration Validations (WAS-165 / SDD #054) ─────────────────────

    function test_selfRegister_noFee_reverts_afterFreeTier() public {
        // Set a registration fee of 1 USDC
        vm.prank(owner);
        marketplace.setRegistrationFee(1_000_000);

        // Use up the 2 free registrations
        vm.startPrank(creator);
        marketplace.selfRegisterAgent("free-agent-1", PRICE, 0);
        marketplace.selfRegisterAgent("free-agent-2", PRICE, 0);

        // 3rd registration without approving USDC — should revert
        vm.expectRevert(); // transferFrom reverts (no balance/allowance)
        marketplace.selfRegisterAgent("my-agent", PRICE, 0);
        vm.stopPrank();
    }

    function test_selfRegister_freeTier_noFeeCharged() public {
        uint256 fee = 1_000_000;
        vm.prank(owner);
        marketplace.setRegistrationFee(fee);

        // First 2 registrations should be free (no USDC needed)
        vm.startPrank(creator);
        marketplace.selfRegisterAgent("free-1", PRICE, 0);
        marketplace.selfRegisterAgent("free-2", PRICE, 0);
        vm.stopPrank();

        // No USDC was transferred
        assertEq(usdc.balanceOf(address(marketplace)), 0);
        assertEq(marketplace.userRegistrationCount(creator), 2);
    }

    function test_selfRegister_slugTooLong_reverts() public {
        // Build a slug of 81 chars
        bytes memory longSlug = new bytes(81);
        for (uint256 i = 0; i < 81; i++) longSlug[i] = "a";

        vm.prank(creator);
        vm.expectRevert("Invalid slug length");
        marketplace.selfRegisterAgent(string(longSlug), PRICE, 0);
    }

    function test_selfRegister_priceTooLow_reverts() public {
        vm.prank(creator);
        vm.expectRevert("Price out of range");
        marketplace.selfRegisterAgent("low-price", 999, 0);
    }

    function test_selfRegister_priceTooHigh_reverts() public {
        vm.prank(creator);
        vm.expectRevert("Price out of range");
        marketplace.selfRegisterAgent("high-price", 100_000_001, 0);
    }

    function test_selfRegister_withFee_succeeds_afterFreeTier() public {
        uint256 fee = 1_000_000; // 1 USDC
        vm.prank(owner);
        marketplace.setRegistrationFee(fee);

        // Use up free tier
        vm.startPrank(creator);
        marketplace.selfRegisterAgent("free-a", PRICE, 0);
        marketplace.selfRegisterAgent("free-b", PRICE, 0);
        vm.stopPrank();

        // 3rd registration — needs fee
        usdc.mint(creator, fee);
        vm.startPrank(creator);
        usdc.approve(address(marketplace), fee);
        marketplace.selfRegisterAgent("paid-agent", PRICE, 0);
        vm.stopPrank();

        WasiAIMarketplace.Agent memory agent = marketplace.getAgent("paid-agent");
        assertEq(agent.creator, creator);
        assertEq(agent.pricePerCall, PRICE);
        // Fee transferred to contract
        assertEq(usdc.balanceOf(address(marketplace)), fee);
        assertEq(usdc.balanceOf(creator), 0);
        assertEq(marketplace.userRegistrationCount(creator), 3);
    }

    function test_setRegistrationFee_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        marketplace.setRegistrationFee(1_000_000);
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

    // WAS-161: test_RecordInvocation_InactiveAgent removed — active field removed from contract
    // Status is now controlled off-chain in Supabase

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
        marketplace.proposeFee(500);
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(owner);
        marketplace.executeFee();
        assertEq(marketplace.platformFeeBps(), 500);
    }

    function test_SetPlatformFee_TooHigh() public {
        vm.prank(owner);
        vm.expectRevert("WasiAI: max 30%");
        marketplace.proposeFee(3001);
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

    // WAS-161: test_SettleKeyBatch_InactiveAgent removed — active field removed from contract

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
        marketplace.proposeFee(0);
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(owner);
        marketplace.executeFee();

        _registerAgent(SLUG, creator);
        usdc.mint(address(marketplace), PRICE);
        vm.prank(operator);
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("pid-zero-fee"));

        assertEq(marketplace.getPendingEarnings(creator), PRICE);
        assertEq(usdc.balanceOf(treasury), 0);
    }

    function test_EdgeCase_MaxFee_Treasury30pct() public {
        vm.prank(owner);
        marketplace.proposeFee(3000);
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(owner);
        marketplace.executeFee();

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
        marketplace.proposeFee(3001);
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

        uint256 fee    = (PRICE * 1000) / 10000;
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
        vm.expectRevert("WasiAI: agent not found");
        marketplace.recordInvocation("nonexistent-agent", payer, PRICE, keccak256("pid-unknown"));
    }

    // Admin edge cases

    // NA-202: setTreasury reemplazado por proposeTreasury/executeTreasury (48h timelock)
    function test_EdgeCase_ProposeTreasury_ZeroAddress_Reverts() public {
        vm.prank(owner);
        vm.expectRevert("WasiAI: zero address");
        marketplace.proposeTreasury(address(0));
    }

    function test_EdgeCase_ProposeTreasury_SameAddress_Reverts() public {
        // treasury inicial = address(0x2) (definido en setUp)
        address currentTreasury = marketplace.treasury();
        vm.prank(owner);
        vm.expectRevert("WasiAI: same treasury");
        marketplace.proposeTreasury(currentTreasury);
    }

    function test_EdgeCase_ExecuteTreasury_BeforeTimelock_Reverts() public {
        address newTreasury = address(0xBB);
        vm.prank(owner);
        marketplace.proposeTreasury(newTreasury);
        vm.prank(owner);
        vm.expectRevert("WasiAI: timelock active");
        marketplace.executeTreasury();
    }

    function test_EdgeCase_ExecuteTreasury_AfterTimelock_Success() public {
        address newTreasury = address(0xBB);
        vm.prank(owner);
        marketplace.proposeTreasury(newTreasury);
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(owner);
        marketplace.executeTreasury();
        assertEq(marketplace.treasury(), newTreasury);
        assertEq(marketplace.pendingTreasury(), address(0));
    }

    function test_EdgeCase_CancelTreasury_Success() public {
        address newTreasury = address(0xBB);
        vm.prank(owner);
        marketplace.proposeTreasury(newTreasury);
        vm.prank(owner);
        marketplace.cancelTreasury();
        assertEq(marketplace.pendingTreasury(), address(0));
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
            marketplace.proposeFee(bps);
        } else {
            marketplace.proposeFee(bps);
            vm.warp(block.timestamp + 48 hours + 1);
            vm.prank(owner);
            marketplace.executeFee();
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

        uint256 totalFee      = (PRICE * 1000 * n) / 10000;
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
        // NA-210 FIX: recordInvocation ahora tiene whenNotPaused — unpause primero para cargar earnings
        vm.prank(owner);
        marketplace.unpause();
        usdc.mint(address(marketplace), PRICE);
        vm.prank(operator);
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("prc1"));
        // Re-pause para verificar que withdraw() sigue funcionando paused
        vm.prank(owner);
        marketplace.pause();
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

    // ── Fee Timelock Tests ────────────────────────────────────────────────────

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

    // ── Solvency Tests ────────────────────────────────────────────────────────

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
        assertEq(marketplace.totalEarnings(), marketplace.getPendingEarnings(creator));
    }

    // Fuzz: random operations must keep checkSolvency() == true
    function testFuzz_Solvency_AlwaysHolds(uint96 depositAmt, uint8 numCalls) public {
        vm.assume(depositAmt >= PRICE && depositAmt <= 10_000_000);
        vm.assume(numCalls > 0 && numCalls <= 10);
        uint256 callsToSettle = uint256(numCalls) % (depositAmt / PRICE + 1);
        if (callsToSettle == 0) callsToSettle = 1;
        uint256 totalCost = callsToSettle * PRICE;
        vm.assume(totalCost <= depositAmt);

        _registerAgent(SLUG, creator);
        _fundKey(KEY_ID, payer, depositAmt);

        (bool s1,,) = marketplace.checkSolvency();
        assertTrue(s1, "Solvent after deposit");

        string[] memory slugs = new string[](callsToSettle);
        uint256[] memory amounts = new uint256[](callsToSettle);
        for (uint i = 0; i < callsToSettle; i++) { slugs[i] = SLUG; amounts[i] = PRICE; }
        vm.prank(operator);
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);

        (bool s2,,) = marketplace.checkSolvency();
        assertTrue(s2, "Solvent after settle");

        vm.prank(creator);
        marketplace.withdraw();

        (bool s3,,) = marketplace.checkSolvency();
        assertTrue(s3, "Solvent after withdraw");
    }

    // ── Daily Cap Tests (WAS-94) ──────────────────────────────────────────────

    function _settleKey(bytes32 keyId, uint256 amount) internal {
        string[]  memory slugs_   = new string[](1);
        uint256[] memory amounts_ = new uint256[](1);
        slugs_[0]   = SLUG;
        amounts_[0] = amount;
        vm.prank(operator);
        marketplace.settleKeyBatch(keyId, slugs_, amounts_);
    }

    function test_DailyCap_NormalSettlement_Passes() public {
        _registerAgent(SLUG, creator);
        _fundKey(KEY_ID, payer, 5_000 * 1e6);
        _settleKey(KEY_ID, 5_000 * 1e6); // within 10k default cap
        (, uint256 settled,) = marketplace.getDailySettlementStatus();
        assertEq(settled, 5_000 * 1e6);
    }

    function test_DailyCap_ExceedsCap_Reverts() public {
        _registerAgent(SLUG, creator);
        _fundKey(KEY_ID, payer, 15_000 * 1e6);

        string[]  memory slugs_   = new string[](1);
        uint256[] memory amounts_ = new uint256[](1);
        slugs_[0]   = SLUG;
        amounts_[0] = 15_000 * 1e6;

        vm.prank(operator);
        vm.expectRevert("WasiAI: daily cap exceeded");
        marketplace.settleKeyBatch(KEY_ID, slugs_, amounts_);
    }

    function test_DailyCap_ResetsAfter24h() public {
        _registerAgent(SLUG, creator);
        _fundKey(KEY_ID, payer, 20_000 * 1e6);
        _settleKey(KEY_ID, 9_000 * 1e6); // within cap
        vm.warp(block.timestamp + 24 hours + 1);
        _settleKey(KEY_ID, 9_000 * 1e6); // new day, cap reset
        (, uint256 settled,) = marketplace.getDailySettlementStatus();
        assertEq(settled, 9_000 * 1e6); // only second settle counts
    }

    function test_DailyCap_OwnerCanUpdate() public {
        vm.prank(owner);
        marketplace.setDailySettlementCap(50_000 * 1e6);
        (uint256 cap,,) = marketplace.getDailySettlementStatus();
        assertEq(cap, 50_000 * 1e6);
    }

    function test_DailyCap_ZeroDisablesCap() public {
        // NA-212 FIX: cap=0 ya no es permitido (min 100 USDC). Cap bajo muy alto permite settlements grandes.
        vm.prank(owner);
        vm.expectRevert("WasiAI: cap too low");
        marketplace.setDailySettlementCap(0);

        // Verificar que el cap por defecto (10k USDC) sigue activo
        (uint256 cap,,) = marketplace.getDailySettlementStatus();
        assertEq(cap, 10_000 * 1e6);
    }

    function test_DailyCap_EmitsDailyCapUpdated() public {
        vm.prank(owner);
        vm.expectEmit(false, false, false, true);
        emit WasiAIMarketplace.DailyCapUpdated(10_000 * 1e6, 25_000 * 1e6);
        marketplace.setDailySettlementCap(25_000 * 1e6);
    }

    function test_DailyCap_OnlyOwnerCanSet() public {
        vm.prank(stranger);
        vm.expectRevert();
        marketplace.setDailySettlementCap(1);
    }

    function test_DailyCap_GetStatus_DefaultValues() public view {
        (uint256 cap, uint256 settled, uint256 resetsAt) = marketplace.getDailySettlementStatus();
        assertEq(cap,    10_000 * 1e6);
        assertEq(settled, 0);
        assertGt(resetsAt, block.timestamp);
    }

    function test_DailyCap_AccumulatesAcrossMultipleBatches() public {
        _registerAgent(SLUG, creator);
        _fundKey(KEY_ID, payer, 10_000 * 1e6);
        _settleKey(KEY_ID, 4_000 * 1e6);
        _settleKey(KEY_ID, 4_000 * 1e6);
        (, uint256 settled,) = marketplace.getDailySettlementStatus();
        assertEq(settled, 8_000 * 1e6);
    }

    function test_DailyCap_ExactCapBoundary_Passes() public {
        _registerAgent(SLUG, creator);
        _fundKey(KEY_ID, payer, 10_000 * 1e6);
        _settleKey(KEY_ID, 10_000 * 1e6); // exactly at cap, should pass
        (, uint256 settled,) = marketplace.getDailySettlementStatus();
        assertEq(settled, 10_000 * 1e6);
    }

    // ── WAS-93: computePaymentId Tests ────────────────────────────────────────

    function test_ComputePaymentId_Deterministic() public view {
        bytes32 nonce = keccak256("test-nonce-1");
        bytes32 id1 = marketplace.computePaymentId(SLUG, payer, PRICE, nonce);
        bytes32 id2 = marketplace.computePaymentId(SLUG, payer, PRICE, nonce);
        assertEq(id1, id2, "Same inputs = same paymentId");
    }

    function test_ComputePaymentId_DifferentNonce_DifferentId() public view {
        bytes32 nonce1 = keccak256("nonce-1");
        bytes32 nonce2 = keccak256("nonce-2");
        bytes32 id1 = marketplace.computePaymentId(SLUG, payer, PRICE, nonce1);
        bytes32 id2 = marketplace.computePaymentId(SLUG, payer, PRICE, nonce2);
        assertTrue(id1 != id2, "Different nonce = different paymentId");
    }

    function test_ComputePaymentId_MatchesExpected() public view {
        // NA-209 FIX: computePaymentId ahora usa abi.encode (sin colisiones) en vez de encodePacked
        bytes32 nonce = bytes32(uint256(1));
        bytes32 expected = keccak256(abi.encode(SLUG, payer, PRICE, nonce, block.chainid));
        bytes32 result = marketplace.computePaymentId(SLUG, payer, PRICE, nonce);
        assertEq(result, expected);
    }

    // ── Reputation Batch Tests ───────────────────────────────────────────────

    function test_submitReputationBatch_single() public {
        vm.prank(operator);
        marketplace.registerAgent("test-agent", PRICE, creator, 0);

        string[] memory slugs = new string[](1);
        slugs[0] = "test-agent";
        uint16[] memory ratings = new uint16[](1);
        ratings[0] = 450;
        uint32[] memory counts = new uint32[](1);
        counts[0] = 42;

        vm.prank(operator);
        marketplace.submitReputationBatch(slugs, ratings, counts);

        (uint16 avg, uint32 cnt, uint64 ts) = marketplace.getReputation("test-agent");
        assertEq(avg, 450);
        assertEq(cnt, 42);
        assertGt(ts, 0);
    }

    function test_submitReputationBatch_multi() public {
        vm.startPrank(operator);
        marketplace.registerAgent("agent-a", PRICE, creator, 0);
        marketplace.registerAgent("agent-b", 30000, creator, 0);

        string[] memory slugs = new string[](2);
        slugs[0] = "agent-a";
        slugs[1] = "agent-b";
        uint16[] memory ratings = new uint16[](2);
        ratings[0] = 500;
        ratings[1] = 250;
        uint32[] memory counts = new uint32[](2);
        counts[0] = 100;
        counts[1] = 5;

        marketplace.submitReputationBatch(slugs, ratings, counts);
        vm.stopPrank();

        (uint16 avg1,,) = marketplace.getReputation("agent-a");
        (uint16 avg2,,) = marketplace.getReputation("agent-b");
        assertEq(avg1, 500);
        assertEq(avg2, 250);
    }

    function test_submitReputationBatch_overwrite() public {
        vm.startPrank(operator);
        marketplace.registerAgent("overwrite-test", PRICE, creator, 0);

        string[] memory slugs = new string[](1);
        slugs[0] = "overwrite-test";
        uint16[] memory ratings = new uint16[](1);
        ratings[0] = 300;
        uint32[] memory counts = new uint32[](1);
        counts[0] = 10;

        marketplace.submitReputationBatch(slugs, ratings, counts);

        ratings[0] = 480;
        counts[0] = 25;
        marketplace.submitReputationBatch(slugs, ratings, counts);
        vm.stopPrank();

        (uint16 avg, uint32 cnt,) = marketplace.getReputation("overwrite-test");
        assertEq(avg, 480);
        assertEq(cnt, 25);
    }

    function test_submitReputationBatch_notOperator_Reverts() public {
        vm.prank(operator);
        marketplace.registerAgent("no-op-test", PRICE, creator, 0);

        string[] memory slugs = new string[](1);
        slugs[0] = "no-op-test";
        uint16[] memory ratings = new uint16[](1);
        ratings[0] = 400;
        uint32[] memory counts = new uint32[](1);
        counts[0] = 1;

        vm.prank(address(0xBEEF));
        vm.expectRevert("WasiAI: not operator");
        marketplace.submitReputationBatch(slugs, ratings, counts);
    }

    function test_submitReputationBatch_ratingTooHigh_Reverts() public {
        vm.prank(operator);
        marketplace.registerAgent("high-rating", PRICE, creator, 0);

        string[] memory slugs = new string[](1);
        slugs[0] = "high-rating";
        uint16[] memory ratings = new uint16[](1);
        ratings[0] = 501;
        uint32[] memory counts = new uint32[](1);
        counts[0] = 1;

        vm.prank(operator);
        vm.expectRevert("WasiAI: rating out of range");
        marketplace.submitReputationBatch(slugs, ratings, counts);
    }

    function test_submitReputationBatch_emptyBatch_Reverts() public {
        string[] memory slugs = new string[](0);
        uint16[] memory ratings = new uint16[](0);
        uint32[] memory counts = new uint32[](0);

        vm.prank(operator);
        vm.expectRevert("WasiAI: empty batch");
        marketplace.submitReputationBatch(slugs, ratings, counts);
    }

    function test_submitReputationBatch_agentNotFound_Reverts() public {
        string[] memory slugs = new string[](1);
        slugs[0] = "nonexistent-agent";
        uint16[] memory ratings = new uint16[](1);
        ratings[0] = 400;
        uint32[] memory counts = new uint32[](1);
        counts[0] = 1;

        vm.prank(operator);
        vm.expectRevert("WasiAI: agent not found");
        marketplace.submitReputationBatch(slugs, ratings, counts);
    }

    function test_submitReputationBatch_lengthMismatch_Reverts() public {
        string[] memory slugs = new string[](1);
        slugs[0] = "mismatch-test";
        uint16[] memory ratings = new uint16[](2);
        ratings[0] = 400;
        ratings[1] = 300;
        uint32[] memory counts = new uint32[](1);
        counts[0] = 1;

        vm.prank(operator);
        vm.expectRevert("WasiAI: length mismatch");
        marketplace.submitReputationBatch(slugs, ratings, counts);
    }

    // ── Helper ────────────────────────────────────────────────────────────────

    function _setupAndInvoke() internal {
        _registerAgent(SLUG, creator);
        usdc.mint(address(marketplace), PRICE);
        vm.prank(operator);
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("pid-helper"));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// WAS-89: Real ERC-3009 signature tests
//
// WHY the rest of the test suite uses MockUSDC (mock bypass):
//   All other tests focus on marketplace business logic (splits, caps, roles,
//   emergency paths, etc.). MockUSDC skips signature verification so those
//   tests stay fast and decoupled from USDC internals. The ERC-3009 signature
//   path is exercised exclusively in WAS89_ERC3009SignatureTest below, which
//   deploys MockUSDCReal — a minimal but spec-compliant implementation that
//   verifies ECDSA signatures and enforces nonce uniqueness.
// ─────────────────────────────────────────────────────────────────────────────

/// @dev Minimal ERC-3009 implementation with real ECDSA signature verification.
contract MockUSDCReal {
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");

    bytes32 public immutable DOMAIN_SEPARATOR;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    constructor() {
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("USD Coin")),
            keccak256(bytes("2")),
            block.chainid,
            address(this)
        ));
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
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

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8   v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp > validAfter,  "ERC3009: auth not yet valid");
        require(block.timestamp < validBefore, "ERC3009: auth expired");
        require(!authorizationState[from][nonce], "ERC3009: auth already used");

        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
            from, to, value, validAfter, validBefore, nonce
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == from, "ERC3009: invalid signature");

        authorizationState[from][nonce] = true;
        require(balanceOf[from] >= value, "ERC3009: insufficient balance");
        balanceOf[from] -= value;
        balanceOf[to]   += value;
    }
}

contract WAS89_ERC3009SignatureTest is Test {
    WasiAIMarketplace marketplace;
    MockUSDCReal      usdcReal;

    address owner    = address(0x1);
    address treasury = address(0x2);
    address operator = address(0x5);

    // Foundry default account #0
    uint256 constant SIGNER_PRIV = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    bytes32 constant KEY_REAL = bytes32(uint256(0xBEEF0001));

    function setUp() public {
        vm.startPrank(owner);
        usdcReal    = new MockUSDCReal();
        marketplace = new WasiAIMarketplace(address(usdcReal), treasury);
        marketplace.setOperator(operator, true);
        vm.stopPrank();
    }

    function _buildDigest(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            usdcReal.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(),
            from, to, value, validAfter, validBefore, nonce
        ));
        return keccak256(abi.encodePacked("\x19\x01", usdcReal.DOMAIN_SEPARATOR(), structHash));
    }

    /// WAS-89-1: Happy path - valid ECDSA signature funds the key.
    function test_ERC3009_DepositForKey_RealSignature() public {
        address signer = vm.addr(SIGNER_PRIV);
        uint256 amount = 1_000_000;
        usdcReal.mint(signer, amount);

        uint256 validAfter  = 0;
        uint256 validBefore = type(uint256).max;
        bytes32 nonce       = keccak256("was89-nonce-1");

        bytes32 digest = _buildDigest(signer, address(marketplace), amount, validAfter, validBefore, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PRIV, digest);

        vm.prank(operator);
        marketplace.depositForKey(KEY_REAL, signer, amount, validAfter, validBefore, nonce, v, r, s);

        assertEq(marketplace.getKeyBalance(KEY_REAL), amount);
        assertEq(marketplace.keyOwners(KEY_REAL), signer);
        assertEq(usdcReal.balanceOf(address(marketplace)), amount);
        assertEq(usdcReal.balanceOf(signer), 0);
    }

    /// WAS-89-2: Wrong signer - signature from a different private key must revert.
    function test_ERC3009_DepositForKey_WrongSignature_Reverts() public {
        address signer  = vm.addr(SIGNER_PRIV);
        // Foundry default account #1
        uint256 wrongPriv = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
        uint256 amount  = 500_000;
        usdcReal.mint(signer, amount);

        uint256 validAfter  = 0;
        uint256 validBefore = type(uint256).max;
        bytes32 nonce       = keccak256("was89-nonce-2");

        bytes32 digest = _buildDigest(signer, address(marketplace), amount, validAfter, validBefore, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongPriv, digest);

        vm.prank(operator);
        vm.expectRevert("ERC3009: invalid signature");
        marketplace.depositForKey(KEY_REAL, signer, amount, validAfter, validBefore, nonce, v, r, s);
    }

    /// WAS-89-3: Replay attack - reusing the same nonce must revert on second call.
    function test_ERC3009_DepositForKey_ReplayAttack_Reverts() public {
        address signer = vm.addr(SIGNER_PRIV);
        uint256 amount = 300_000;
        usdcReal.mint(signer, amount * 2);

        uint256 validAfter  = 0;
        uint256 validBefore = type(uint256).max;
        bytes32 nonce       = keccak256("was89-replay-nonce");

        bytes32 digest = _buildDigest(signer, address(marketplace), amount, validAfter, validBefore, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PRIV, digest);

        // First deposit: ok
        vm.prank(operator);
        marketplace.depositForKey(KEY_REAL, signer, amount, validAfter, validBefore, nonce, v, r, s);

        // Second deposit with same nonce: must fail
        vm.prank(operator);
        vm.expectRevert("ERC3009: auth already used");
        marketplace.depositForKey(
            bytes32(uint256(KEY_REAL) + 1),
            signer, amount, validAfter, validBefore, nonce, v, r, s
        );
    }
}
