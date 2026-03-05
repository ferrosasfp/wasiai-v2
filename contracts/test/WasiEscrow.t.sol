// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/WasiEscrow.sol";

/// @dev MockUSDC con ERC-3009 sin verificación de firma (para tests)
contract MockUSDCEscrow {
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

    function transferWithAuthorization(
        address from, address to, uint256 value,
        uint256, uint256, bytes32, uint8, bytes32, bytes32
    ) external {
        require(balanceOf[from] >= value, "MockUSDC: insufficient");
        balanceOf[from] -= value;
        balanceOf[to]   += value;
    }
}

contract WasiEscrowTest is Test {
    WasiEscrow      escrow;
    MockUSDCEscrow  usdc;

    address owner       = address(0x1);
    address marketplace = address(0x2);
    address payer       = address(0x3);
    address operator    = address(0x4);
    address stranger    = address(0x5);

    string  constant SLUG   = "long-agent";
    uint256 constant AMOUNT = 1_000_000; // 1 USDC

    bytes32 escrowId;

    function setUp() public {
        vm.startPrank(owner);
        usdc   = new MockUSDCEscrow();
        escrow = new WasiEscrow(address(usdc), marketplace);
        escrow.setOperator(operator, true);
        vm.stopPrank();

        usdc.mint(payer, AMOUNT * 10);
        escrowId = keccak256(abi.encodePacked(SLUG, payer, AMOUNT, bytes32(0), block.chainid));
    }

    function _createEscrow() internal {
        vm.prank(operator);
        escrow.createEscrow(
            escrowId, SLUG, payer, AMOUNT,
            0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0)
        );
    }

    // ── Tests ─────────────────────────────────────────────────────────────────

    function test_CreateEscrow_HappyPath() public {
        _createEscrow();
        WasiEscrow.EscrowTx memory e = escrow.getEscrow(escrowId);
        assertEq(e.payer, payer);
        assertEq(e.amount, AMOUNT);
        assertEq(uint(e.status), uint(WasiEscrow.EscrowStatus.Pending));
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
    }

    function test_ReleaseEscrow_ToMarketplace() public {
        _createEscrow();
        vm.prank(operator);
        escrow.releaseEscrow(escrowId);
        assertEq(usdc.balanceOf(marketplace), AMOUNT);
        assertEq(uint(escrow.getEscrow(escrowId).status), uint(WasiEscrow.EscrowStatus.Released));
    }

    function test_RefundEscrow() public {
        _createEscrow();
        uint256 before = usdc.balanceOf(payer);
        vm.prank(operator);
        escrow.refundEscrow(escrowId);
        assertEq(usdc.balanceOf(payer), before + AMOUNT);
        assertEq(uint(escrow.getEscrow(escrowId).status), uint(WasiEscrow.EscrowStatus.Refunded));
    }

    // NA-204 FIX: RELEASE_TIMEOUT ahora es 72h (no 24h), solo operador/owner/marketplace
    function test_ReleaseExpired_After72h_ByOperator() public {
        _createEscrow();
        vm.warp(block.timestamp + 73 hours);
        vm.prank(operator);
        escrow.releaseExpired(escrowId);
        assertEq(usdc.balanceOf(marketplace), AMOUNT);
    }

    function test_ReleaseExpired_After72h_ByStranger_Reverts() public {
        _createEscrow();
        vm.warp(block.timestamp + 73 hours);
        vm.prank(stranger);
        vm.expectRevert("WasiEscrow: not authorized");
        escrow.releaseExpired(escrowId);
    }

    function test_ReleaseExpired_Before72h_Reverts() public {
        _createEscrow();
        vm.warp(block.timestamp + 25 hours); // antes de 72h
        vm.prank(operator);
        vm.expectRevert("WasiEscrow: timeout not reached");
        escrow.releaseExpired(escrowId);
    }

    function test_CreateEscrow_WrongSignature_Reverts() public {
        // MockUSDC no verifica la firma pero sí verifica balance
        // Para simular firma inválida: usar un payer sin balance
        address poorPayer = address(0x99);
        bytes32 badEscrowId = keccak256(abi.encodePacked(SLUG, poorPayer, AMOUNT, bytes32(0), block.chainid));
        vm.prank(operator);
        vm.expectRevert("MockUSDC: insufficient");
        escrow.createEscrow(
            badEscrowId, SLUG, poorPayer, AMOUNT,
            0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0)
        );
    }

    function test_CreateEscrow_DuplicateReverts() public {
        _createEscrow();
        vm.prank(operator);
        vm.expectRevert("WasiEscrow: escrowId exists");
        escrow.createEscrow(
            escrowId, SLUG, payer, AMOUNT,
            0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0)
        );
    }

    function test_Stranger_CannotRelease() public {
        _createEscrow();
        vm.prank(stranger);
        vm.expectRevert("WasiEscrow: not operator");
        escrow.releaseEscrow(escrowId);
    }

    function test_ReleaseAlreadyReleased_Reverts() public {
        _createEscrow();
        vm.prank(operator);
        escrow.releaseEscrow(escrowId);
        vm.prank(operator);
        vm.expectRevert("WasiEscrow: not pending");
        escrow.releaseEscrow(escrowId);
    }

    function test_DisputeEscrow() public {
        _createEscrow();
        vm.prank(operator);
        escrow.disputeEscrow(escrowId);
        assertEq(uint(escrow.getEscrow(escrowId).status), uint(WasiEscrow.EscrowStatus.Disputed));
    }

    // ── NA-204 FIX: refundExpired ─────────────────────────────────────────────

    function test_RefundExpired_After72h_ByPayer() public {
        _createEscrow();
        uint256 payerBefore = usdc.balanceOf(payer);
        vm.warp(block.timestamp + 73 hours);
        vm.prank(payer);
        escrow.refundExpired(escrowId);
        assertEq(usdc.balanceOf(payer), payerBefore + AMOUNT);
        assertEq(uint(escrow.getEscrow(escrowId).status), uint(WasiEscrow.EscrowStatus.Refunded));
    }

    function test_RefundExpired_After72h_ByOperator() public {
        _createEscrow();
        uint256 payerBefore = usdc.balanceOf(payer);
        vm.warp(block.timestamp + 73 hours);
        vm.prank(operator);
        escrow.refundExpired(escrowId);
        assertEq(usdc.balanceOf(payer), payerBefore + AMOUNT);
    }

    function test_RefundExpired_After72h_ByStranger_Reverts() public {
        _createEscrow();
        vm.warp(block.timestamp + 73 hours);
        vm.prank(stranger);
        vm.expectRevert("WasiEscrow: not authorized");
        escrow.refundExpired(escrowId);
    }

    function test_RefundExpired_Before72h_Reverts() public {
        _createEscrow();
        vm.prank(payer);
        vm.expectRevert("WasiEscrow: timeout not reached");
        escrow.refundExpired(escrowId);
    }

    function test_RefundExpired_AlreadyRefunded_Reverts() public {
        _createEscrow();
        vm.warp(block.timestamp + 73 hours);
        vm.prank(payer);
        escrow.refundExpired(escrowId);
        vm.prank(payer);
        vm.expectRevert("WasiEscrow: not pending");
        escrow.refundExpired(escrowId);
    }

    // ── NA-204: emergencyRefund (30 days) ─────────────────────────────────────

    function test_EmergencyRefund_After30Days_ByAnyone() public {
        _createEscrow();
        uint256 payerBefore = usdc.balanceOf(payer);
        vm.warp(block.timestamp + 31 days);
        vm.prank(stranger); // cualquiera puede llamar
        escrow.emergencyRefund(escrowId);
        assertEq(usdc.balanceOf(payer), payerBefore + AMOUNT);
    }

    function test_EmergencyRefund_Before30Days_Reverts() public {
        _createEscrow();
        vm.warp(block.timestamp + 29 days);
        vm.prank(stranger);
        vm.expectRevert("WasiEscrow: emergency not active");
        escrow.emergencyRefund(escrowId);
    }

    // ── NA-208: resolveDispute ────────────────────────────────────────────────

    function test_ResolveDispute_Release_ByOwner() public {
        _createEscrow();
        vm.prank(operator);
        escrow.disputeEscrow(escrowId);
        vm.prank(owner);
        escrow.resolveDispute(escrowId, true); // release to marketplace
        assertEq(usdc.balanceOf(marketplace), AMOUNT);
        assertEq(uint(escrow.getEscrow(escrowId).status), uint(WasiEscrow.EscrowStatus.Released));
    }

    function test_ResolveDispute_Refund_ByOwner() public {
        _createEscrow();
        vm.prank(operator);
        escrow.disputeEscrow(escrowId);
        uint256 payerBefore = usdc.balanceOf(payer);
        vm.prank(owner);
        escrow.resolveDispute(escrowId, false); // refund to payer
        assertEq(usdc.balanceOf(payer), payerBefore + AMOUNT);
        assertEq(uint(escrow.getEscrow(escrowId).status), uint(WasiEscrow.EscrowStatus.Refunded));
    }

    function test_ResolveDispute_ByOperator_Reverts() public {
        _createEscrow();
        vm.prank(operator);
        escrow.disputeEscrow(escrowId);
        vm.prank(operator); // operador NO puede resolver disputas
        vm.expectRevert();
        escrow.resolveDispute(escrowId, true);
    }

    function test_ResolveDispute_NotDisputed_Reverts() public {
        _createEscrow();
        vm.prank(owner);
        vm.expectRevert("WasiEscrow: not disputed");
        escrow.resolveDispute(escrowId, true);
    }
}
