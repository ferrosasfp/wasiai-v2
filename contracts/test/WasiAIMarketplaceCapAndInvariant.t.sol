// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../src/WasiAIMarketplace.sol";

/// @dev Minimal ERC-20 mock with ERC-3009 support (mirrors WasiAIMarketplace.t.sol).
contract MockUSDCCap {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
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
        require(balanceOf[from] >= value, "MockUSDC: insufficient balance for auth");
        balanceOf[from] -= value;
        balanceOf[to]   += value;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// M-1: claimEarnings must respect dailySettlementCap (audit 2026-06-25)
// ─────────────────────────────────────────────────────────────────────────────
contract WasiAIMarketplaceClaimCapTest is Test {
    WasiAIMarketplace marketplace;
    MockUSDCCap       usdc;

    // Foundry account #0 / #2 — deterministic signing.
    uint256 constant OWNER_PK    = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant OPERATOR_PK = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;

    address owner;
    address operatorAddr;
    address treasury = address(0x2);
    address creator  = address(0xA1);

    string  constant SLUG  = "agent-alpha";
    uint256 constant PRICE = 20_000; // $0.02 USDC

    function setUp() public {
        owner        = vm.addr(OWNER_PK);
        operatorAddr = vm.addr(OPERATOR_PK);

        vm.startPrank(owner);
        usdc        = new MockUSDCCap();
        marketplace = new WasiAIMarketplace(address(usdc), treasury);
        marketplace.setOperator(operatorAddr, true);
        vm.stopPrank();
    }

    function _registerAgent(string memory slug, address agentCreator, uint256 price) internal {
        vm.prank(operatorAddr);
        marketplace.registerAgent(slug, price, agentCreator, 0);
    }

    function _buildClaimDigest(
        address c, uint256 grossAmount, uint256 deadline, bytes32 nonce
    ) internal view returns (bytes32) {
        bytes32 CLAIM_TYPEHASH = keccak256(
            "ClaimEarnings(address creator,uint256 grossAmount,uint256 deadline,bytes32 nonce)"
        );
        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, c, grossAmount, deadline, nonce));
        bytes32 TYPE_HASH = keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
        bytes32 domainSep = keccak256(abi.encode(
            TYPE_HASH,
            keccak256(bytes("WasiAIMarketplace")),
            keccak256(bytes("1")),
            block.chainid,
            address(marketplace)
        ));
        return keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
    }

    function _signClaimVoucher(
        address c, uint256 grossAmount, uint256 deadline, bytes32 nonce
    ) internal view returns (bytes memory) {
        bytes32 digest = _buildClaimDigest(c, grossAmount, deadline, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OPERATOR_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    // The cap setter bounds newCap to [100 USDC, 100k USDC]; 0 (disabled) is not
    // settable post-deploy, so cap tests use the 100 USDC minimum and USDC-scale
    // claim amounts.
    uint256 constant CAP_MIN = 100 * 1e6; // 100 USDC

    /// M-1: a claim that exceeds the daily cap must revert with "daily cap exceeded".
    function test_M1_claimEarnings_RevertsWhenOverDailyCap() public {
        vm.prank(owner);
        marketplace.setDailySettlementCap(CAP_MIN); // 100 USDC
        usdc.mint(address(marketplace), 1_000 * 1e6);

        uint256 grossAmount = 200 * 1e6; // > cap
        uint256 deadline    = block.timestamp + 1 days;
        bytes32 nonce       = keccak256("claim-over-cap");
        bytes memory sig    = _signClaimVoucher(creator, grossAmount, deadline, nonce);

        vm.prank(creator);
        vm.expectRevert("WasiAI: daily cap exceeded");
        marketplace.claimEarnings(creator, grossAmount, deadline, nonce, sig);
    }

    /// M-1: a claim within the cap succeeds and advances the daily settled counter.
    function test_M1_claimEarnings_WithinCap_Succeeds_AndCounts() public {
        vm.prank(owner);
        marketplace.setDailySettlementCap(1_000 * 1e6);
        usdc.mint(address(marketplace), 10_000 * 1e6);

        uint256 grossAmount = 200 * 1e6;
        uint256 deadline    = block.timestamp + 1 days;
        bytes32 nonce       = keccak256("claim-under-cap");
        bytes memory sig    = _signClaimVoucher(creator, grossAmount, deadline, nonce);

        vm.prank(creator);
        marketplace.claimEarnings(creator, grossAmount, deadline, nonce, sig);

        assertEq(marketplace.dailySettledAmount(), grossAmount, "claim must count against daily window");
    }

    /// M-1: claims accumulate against the cap — a second claim that crosses it reverts.
    function test_M1_claimEarnings_AccumulatesTowardCap() public {
        vm.prank(owner);
        marketplace.setDailySettlementCap(300 * 1e6);
        usdc.mint(address(marketplace), 10_000 * 1e6);

        uint256 deadline = block.timestamp + 1 days;

        // First claim 200 USDC — ok (200 <= 300).
        bytes memory sig1 = _signClaimVoucher(creator, 200 * 1e6, deadline, keccak256("c1"));
        vm.prank(creator);
        marketplace.claimEarnings(creator, 200 * 1e6, deadline, keccak256("c1"), sig1);

        // Second claim 200 USDC — would be 400 > 300 → revert.
        bytes memory sig2 = _signClaimVoucher(creator, 200 * 1e6, deadline, keccak256("c2"));
        vm.prank(creator);
        vm.expectRevert("WasiAI: daily cap exceeded");
        marketplace.claimEarnings(creator, 200 * 1e6, deadline, keccak256("c2"), sig2);
    }

    /// M-1: the window resets after 24h, allowing fresh claims up to the cap again.
    function test_M1_claimEarnings_DailyWindowResets() public {
        vm.prank(owner);
        marketplace.setDailySettlementCap(200 * 1e6);
        usdc.mint(address(marketplace), 10_000 * 1e6);

        uint256 deadline = block.timestamp + 100 days;

        bytes memory sig1 = _signClaimVoucher(creator, 200 * 1e6, deadline, keccak256("w1"));
        vm.prank(creator);
        marketplace.claimEarnings(creator, 200 * 1e6, deadline, keccak256("w1"), sig1);

        // Advance past the 24h window.
        vm.warp(block.timestamp + 24 hours + 1);

        bytes memory sig2 = _signClaimVoucher(creator, 200 * 1e6, deadline, keccak256("w2"));
        vm.prank(creator);
        marketplace.claimEarnings(creator, 200 * 1e6, deadline, keccak256("w2"), sig2);

        assertEq(marketplace.dailySettledAmount(), 200 * 1e6, "window reset: counter starts fresh");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stateful invariant: a handler random-sequences the marketplace money flows and
// the suite asserts solvency holds (mirrors the escrow's invariant approach).
// ─────────────────────────────────────────────────────────────────────────────
contract MarketplaceHandler is Test {
    WasiAIMarketplace public marketplace;
    MockUSDCCap       public usdc;

    uint256 constant OPERATOR_PK = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
    address public operatorAddr;
    address public treasury;

    string  public constant SLUG  = "fuzz-agent";
    uint256 public constant PRICE = 20_000;

    bytes32[] internal keyIds;
    address[] internal creators;

    constructor(WasiAIMarketplace _m, MockUSDCCap _usdc, address _operator, address _treasury) {
        marketplace  = _m;
        usdc         = _usdc;
        operatorAddr = _operator;
        treasury     = _treasury;

        for (uint256 i = 0; i < 4; i++) {
            creators.push(address(uint160(0xC000 + i)));
            keyIds.push(keccak256(abi.encodePacked("key", i)));
        }
    }

    function _creator(uint256 seed) internal view returns (address) {
        return creators[seed % creators.length];
    }
    function _key(uint256 seed) internal view returns (bytes32) {
        return keyIds[seed % keyIds.length];
    }

    /// Fund a key — USDC arrives at the contract and is tracked in totalKeyBalances.
    function depositForKey(uint256 seed, uint96 amount) external {
        uint256 amt = uint256(amount) % 1_000_000 + 1;
        bytes32 keyId = _key(seed);
        address keyOwner = _creator(seed);
        usdc.mint(keyOwner, amt);
        vm.prank(keyOwner);
        usdc.approve(address(marketplace), amt);
        vm.prank(operatorAddr);
        marketplace.depositForKey(
            keyId, keyOwner, amt, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0)
        );
    }

    /// Settle a single-call batch out of the key's funded balance.
    function settleKeyBatch(uint256 seed, uint96 amount) external {
        bytes32 keyId = _key(seed);
        uint256 bal   = marketplace.getKeyBalance(keyId);
        if (bal == 0) return;
        uint256 amt = uint256(amount) % bal + 1;
        if (amt > bal) amt = bal;

        _ensureAgent(_creator(seed));

        string[]  memory slugs   = new string[](1);
        uint256[] memory amounts = new uint256[](1);
        slugs[0]   = SLUG;
        amounts[0] = amt;
        vm.prank(operatorAddr);
        marketplace.settleKeyBatch(keyId, slugs, amounts);
    }

    /// x402 path — funds arrive at the contract, creator earns 90%.
    function recordInvocation(uint256 seed, uint256 nonceSeed) external {
        address c = _creator(seed);
        _ensureAgent(c);
        usdc.mint(address(marketplace), PRICE); // x402 payment arrives
        vm.prank(operatorAddr);
        marketplace.recordInvocation(SLUG, address(0xDAD), PRICE, keccak256(abi.encodePacked("pay", nonceSeed)));
    }

    /// Creator claims earnings via an operator-signed voucher (subject to the cap).
    function claimEarnings(uint256 seed, uint96 amount, uint256 nonceSeed) external {
        address c = _creator(seed);
        // Only claim within the contract's free balance to avoid the balance-guard revert.
        (, uint256 accounted, uint256 balance) = marketplace.checkSolvency();
        uint256 free = balance > accounted ? balance - accounted : 0;
        if (free == 0) return;
        uint256 gross = uint256(amount) % free + 1;
        if (gross > free) gross = free;

        uint256 deadline = block.timestamp + 1 days;
        bytes32 nonce    = keccak256(abi.encodePacked("voucher", nonceSeed, seed));
        bytes32 digest   = _claimDigest(c, gross, deadline, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OPERATOR_PK, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(c);
        try marketplace.claimEarnings(c, gross, deadline, nonce, sig) {} catch {}
    }

    function withdraw(uint256 seed) external {
        address c = _creator(seed);
        if (marketplace.getPendingEarnings(c) == 0) return;
        vm.prank(c);
        marketplace.withdraw();
    }

    function withdrawKey(uint256 seed, uint96 amount) external {
        bytes32 keyId = _key(seed);
        uint256 bal   = marketplace.getKeyBalance(keyId);
        if (bal == 0) return;
        uint256 amt = uint256(amount) % bal + 1;
        if (amt > bal) amt = bal;
        address keyOwner = _creator(seed);
        vm.prank(keyOwner);
        try marketplace.withdrawKey(keyId, amt) {} catch {}
    }

    function refundKeyToEarnings(uint256 seed) external {
        bytes32 keyId = _key(seed);
        if (marketplace.getKeyBalance(keyId) == 0) return;
        vm.prank(operatorAddr);
        try marketplace.refundKeyToEarnings(keyId) {} catch {}
    }

    function advanceTime(uint256 secondsToWarp) external {
        vm.warp(block.timestamp + (secondsToWarp % 3 days));
    }

    // ── internals ──────────────────────────────────────────────────────────────
    bool internal agentRegistered;
    function _ensureAgent(address c) internal {
        if (agentRegistered) return;
        vm.prank(operatorAddr);
        marketplace.registerAgent(SLUG, PRICE, c, 0);
        agentRegistered = true;
    }

    function _claimDigest(
        address c, uint256 gross, uint256 deadline, bytes32 nonce
    ) internal view returns (bytes32) {
        bytes32 CLAIM_TYPEHASH = keccak256(
            "ClaimEarnings(address creator,uint256 grossAmount,uint256 deadline,bytes32 nonce)"
        );
        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, c, gross, deadline, nonce));
        bytes32 TYPE_HASH = keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
        bytes32 domainSep = keccak256(abi.encode(
            TYPE_HASH,
            keccak256(bytes("WasiAIMarketplace")),
            keccak256(bytes("1")),
            block.chainid,
            address(marketplace)
        ));
        return keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
    }
}

contract WasiAIMarketplaceInvariantTest is StdInvariant, Test {
    WasiAIMarketplace marketplace;
    MockUSDCCap       usdc;
    MarketplaceHandler handler;

    uint256 constant OWNER_PK    = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant OPERATOR_PK = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;

    address owner;
    address operatorAddr;
    address treasury = address(0x2);

    function setUp() public {
        owner        = vm.addr(OWNER_PK);
        operatorAddr = vm.addr(OPERATOR_PK);

        vm.startPrank(owner);
        usdc        = new MockUSDCCap();
        marketplace = new WasiAIMarketplace(address(usdc), treasury);
        marketplace.setOperator(operatorAddr, true);
        vm.stopPrank();

        handler = new MarketplaceHandler(marketplace, usdc, operatorAddr, treasury);
        targetContract(address(handler));
    }

    /// Solvency must always hold: contract USDC >= totalKeyBalances + totalEarnings.
    function invariant_marketplaceSolvent() public view {
        (bool solvent, uint256 accounted, uint256 balance) = marketplace.checkSolvency();
        assertTrue(solvent, "marketplace insolvent: balance < keyBalances + earnings");
        assertGe(balance, accounted, "balance must cover all obligations");
    }

    /// The daily settled counter never exceeds the cap (when a cap is set elsewhere
    /// it is enforced; here the default 10k USDC cap bounds settle+claim per window).
    function invariant_dailySettledNeverExceedsCap() public view {
        uint256 cap = marketplace.dailySettlementCap();
        if (cap == 0) return;
        assertLe(marketplace.dailySettledAmount(), cap, "dailySettledAmount exceeded the cap");
    }
}
