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

    string constant SLUG = "gpt-translator";
    uint256 constant PRICE = 20_000; // $0.02 USDC (6 decimals)

    function setUp() public {
        vm.startPrank(owner);
        usdc        = new MockUSDC();
        marketplace = new WasiAIMarketplace(address(usdc), treasury);
        marketplace.setOperator(operator, true);
        vm.stopPrank();
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

    function test_SettleKeyCall_Split() public {
        // Register agent
        vm.prank(operator);
        marketplace.registerAgent(SLUG, PRICE, creator, 0);

        // Fund key
        usdc.mint(payer, PRICE);
        vm.prank(operator);
        marketplace.depositForKey(KEY_ID, payer, PRICE, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));

        // Settle call
        vm.prank(operator);
        marketplace.settleKeyCall(KEY_ID, SLUG, PRICE);

        // Key balance now 0
        assertEq(marketplace.getKeyBalance(KEY_ID), 0);
        // Platform gets 10% = 2000
        assertEq(usdc.balanceOf(treasury), 2_000);
        // Creator gets 90% = 18000
        assertEq(marketplace.getPendingEarnings(creator), 18_000);
        // Stats updated
        assertEq(marketplace.totalVolume(), PRICE);
        assertEq(marketplace.totalInvocations(), 1);
    }

    function test_SettleKeyCall_InsufficientBalance() public {
        vm.prank(operator);
        marketplace.registerAgent(SLUG, PRICE, creator, 0);

        // Key has no balance
        vm.prank(operator);
        vm.expectRevert("WasiAI: insufficient key balance");
        marketplace.settleKeyCall(KEY_ID, SLUG, PRICE);
    }

    function test_SettleKeyCall_InactiveAgent() public {
        vm.startPrank(operator);
        marketplace.registerAgent(SLUG, PRICE, creator, 0);
        marketplace.updateAgent(SLUG, PRICE, false); // pause agent
        vm.stopPrank();

        // Fund key
        usdc.mint(payer, PRICE);
        vm.prank(operator);
        marketplace.depositForKey(KEY_ID, payer, PRICE, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));

        // Try to settle — should fail because agent inactive
        vm.prank(operator);
        vm.expectRevert("WasiAI: agent inactive");
        marketplace.settleKeyCall(KEY_ID, SLUG, PRICE);
    }

    function test_SettleKeyCall_OnlyOperator() public {
        vm.prank(operator);
        marketplace.registerAgent(SLUG, PRICE, creator, 0);

        usdc.mint(payer, PRICE);
        vm.prank(operator);
        marketplace.depositForKey(KEY_ID, payer, PRICE, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));

        vm.prank(payer); // not operator
        vm.expectRevert("WasiAI: not operator");
        marketplace.settleKeyCall(KEY_ID, SLUG, PRICE);
    }

    function test_WithdrawKeyBalance() public {
        // Fund key
        usdc.mint(payer, 1_000_000);
        vm.prank(operator);
        marketplace.depositForKey(KEY_ID, payer, 1_000_000, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));

        // Register agent + settle one call
        vm.prank(operator);
        marketplace.registerAgent(SLUG, PRICE, creator, 0);
        vm.prank(operator);
        marketplace.settleKeyCall(KEY_ID, SLUG, PRICE);

        // Remaining balance = 1_000_000 - 20_000 = 980_000
        uint256 remaining = marketplace.getKeyBalance(KEY_ID);
        assertEq(remaining, 980_000);

        // Payer withdraws
        vm.prank(payer);
        marketplace.withdrawKeyBalance(KEY_ID);

        assertEq(usdc.balanceOf(payer),             remaining);
        assertEq(marketplace.getKeyBalance(KEY_ID), 0);
    }

    function test_WithdrawKeyBalance_NotOwner() public {
        usdc.mint(payer, PRICE);
        vm.prank(operator);
        marketplace.depositForKey(KEY_ID, payer, PRICE, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));

        vm.prank(creator); // different address
        vm.expectRevert("WasiAI: not key owner");
        marketplace.withdrawKeyBalance(KEY_ID);
    }

    function test_WithdrawKeyBalance_NothingToWithdraw() public {
        // Key not funded → keyOwners[KEY_ID] == address(0) ≠ payer, reverts with "not key owner"
        vm.prank(payer);
        vm.expectRevert("WasiAI: not key owner");
        marketplace.withdrawKeyBalance(KEY_ID);
    }

    function test_GetKeyBalance_Empty() public view {
        assertEq(marketplace.getKeyBalance(KEY_ID), 0);
    }
}
