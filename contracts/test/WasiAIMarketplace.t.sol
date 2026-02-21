// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/WasiAIMarketplace.sol";

/// @dev Minimal ERC-20 mock for testing (no real USDC needed)
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
}
