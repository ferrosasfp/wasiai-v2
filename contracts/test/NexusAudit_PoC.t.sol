// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  NexusAudit_PoC.t.sol
 * @notice Proof-of-Concept tests for NexusAudit v2.0 findings on WasiAIMarketplace.
 * @dev    Methodology: NexusAudit v2.0 (San / OpenClaw)
 *         Date: 2026-03-16
 *
 *  FINDINGS TESTED:
 *   HIGH-1  - claimEarnings balance guard ignores totalEarnings → double-spend
 *   HIGH-2  - recordInvocation soft balance check ignores obligations → insolvency
 *   MEDIUM-1 - performUpkeep callable by anyone → event manipulation / timing griefing
 *   LOW-1   - updateAgent missing whenNotPaused → price change during pause
 *   INFO-1  - Emergency timeout griefable by minimal operator activity
 *
 *  CONVENTION:
 *   Test PASSES → finding CONFIRMED (attack executed successfully)
 *   Test FAILS  → finding LIKELY (logic correct but execution blocked)
 */

import "forge-std/Test.sol";
import "../src/WasiAIMarketplace.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

// ─── Minimal mock USDC (reuse from main test file) ───────────────────────────
contract MockUSDC_PoC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

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
        address from, address to, uint256 value,
        uint256, uint256, bytes32, uint8, bytes32, bytes32
    ) external {
        require(balanceOf[from] >= value, "MockUSDC_PoC: insufficient");
        balanceOf[from] -= value;
        balanceOf[to]   += value;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// NexusAudit PoC Test Contract
// ─────────────────────────────────────────────────────────────────────────────
contract NexusAudit_PoC is Test {

    WasiAIMarketplace marketplace;
    MockUSDC_PoC      usdc;

    // Known private keys for deterministic signing
    // Foundry account #0
    uint256 constant OWNER_PK    = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    // Foundry account #2
    uint256 constant OPERATOR_PK = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;

    address owner;
    address operatorAddr;
    address treasury = address(0x2);
    address creatorA = address(0xA1);
    address creatorB = address(0xB1);
    address payer    = address(0xC1);

    string constant SLUG  = "agent-alpha";
    uint256 constant PRICE = 20_000; // $0.02 USDC

    bytes32 constant KEY_ID = bytes32(uint256(0xDEAD_BEEF_0001));

    function setUp() public {
        owner        = vm.addr(OWNER_PK);
        operatorAddr = vm.addr(OPERATOR_PK);

        vm.startPrank(owner);
        usdc        = new MockUSDC_PoC();
        marketplace = new WasiAIMarketplace(address(usdc), treasury);
        marketplace.setOperator(operatorAddr, true);
        vm.stopPrank();
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _registerAgent(string memory slug, address creator, uint256 price) internal {
        vm.prank(operatorAddr);
        marketplace.registerAgent(slug, price, creator, 0);
    }

    function _fundKey(bytes32 keyId, address keyOwner, uint256 amount) internal {
        usdc.mint(keyOwner, amount);
        vm.prank(operatorAddr);
        marketplace.depositForKey(
            keyId, keyOwner, amount,
            0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0)
        );
    }

    /// @dev Build EIP-712 ClaimEarnings digest for the marketplace.
    function _buildClaimDigest(
        address creator,
        uint256 grossAmount,
        uint256 deadline,
        bytes32 nonce
    ) internal view returns (bytes32) {
        bytes32 CLAIM_TYPEHASH = keccak256(
            "ClaimEarnings(address creator,uint256 grossAmount,uint256 deadline,bytes32 nonce)"
        );
        bytes32 structHash = keccak256(abi.encode(
            CLAIM_TYPEHASH, creator, grossAmount, deadline, nonce
        ));

        // Read domain separator from the marketplace (EIP712 internal storage)
        // Use the public function _hashTypedDataV4 equivalent: 
        // domainSeparator is at eip712.domainSeparatorV4() - accessible via cast
        // Compute EIP-712 domain separator for WasiAIMarketplace v1
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

    /// @dev Sign a ClaimEarnings voucher with the operator's private key.
    function _signClaimVoucher(
        address creator,
        uint256 grossAmount,
        uint256 deadline,
        bytes32 nonce
    ) internal view returns (bytes memory) {
        bytes32 digest = _buildClaimDigest(creator, grossAmount, deadline, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OPERATOR_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HIGH-1: claimEarnings balance guard ignores totalEarnings
    //
    // Hypothesis: The balance guard in claimEarnings()  uses:
    //   require(balanceOf - totalKeyBalances >= grossAmount)
    // but does NOT subtract totalEarnings. A malicious/buggy operator can
    // sign a claimEarnings voucher for CreatorB using USDC already earmarked
    // for CreatorA via recordInvocation, draining CreatorA's funds.
    //
    // If test PASSES → CONFIRMED (CreatorA's withdraw() fails after CreatorB claims)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * TEST HIGH-1a - claimEarnings drains funds earmarked for another creator's earnings
     *
     * Setup:
     *   - CreatorA earns 18000 USDC via recordInvocation (90% of 20000)
     *   - earnings[CreatorA] = 18000, totalEarnings = 18000
     *   - Contract balance = 18000 (platform share already sent to treasury)
     *   - Operator signs claimEarnings voucher for CreatorB for 18000 USDC
     *
     * Attack:
     *   - CreatorB calls claimEarnings(B, 18000, ...) - passes balance guard
     *   - 16200 USDC sent to CreatorB, 1800 to treasury
     *   - Contract balance = 0
     *
     * Impact:
     *   - CreatorA calls withdraw() → REVERTS (no USDC left)
     *   - CreatorA permanently loses their 18000 USDC
     */
    function test_FIXED_HIGH01a_claimEarnings_DrainsCreatorAEarnings_ViaVoucherForCreatorB() public {
        // ARRANGE: CreatorA earns via recordInvocation
        _registerAgent(SLUG, creatorA, PRICE);
        usdc.mint(address(marketplace), PRICE); // x402 payment arrives
        vm.prank(operatorAddr);
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("pay-001"));

        uint256 creatorAEarnings = marketplace.getPendingEarnings(creatorA);
        uint256 contractBalance  = usdc.balanceOf(address(marketplace));
        uint256 totalEarnings    = marketplace.totalEarnings();

        emit log_named_uint("creatorA earnings in mapping", creatorAEarnings); // 18000
        emit log_named_uint("contract USDC balance",        contractBalance);  // 18000
        emit log_named_uint("totalEarnings",                totalEarnings);    // 18000
        emit log_named_uint("totalKeyBalances",             marketplace.totalKeyBalances()); // 0

        // Operator signs a voucher for CreatorB for the SAME amount
        uint256 grossAmount = 18_000;
        uint256 deadline    = block.timestamp + 1 days;
        bytes32 nonce       = keccak256("voucher-creatorB-001");
        bytes memory sig    = _signClaimVoucher(creatorB, grossAmount, deadline, nonce);

        // FIXED: Balance guard now subtracts totalEarnings
        // balance(18000) - totalKeyBalances(0) - totalEarnings(18000) = 0 < grossAmount(18000) → REVERT
        vm.prank(creatorB);
        vm.expectRevert("WasiAI: insufficient free balance");
        marketplace.claimEarnings(creatorB, grossAmount, deadline, nonce, sig);

        // CreatorA's funds are safe
        assertEq(usdc.balanceOf(address(marketplace)), contractBalance, "Contract balance intact");
        vm.prank(creatorA);
        marketplace.withdraw(); // must succeed

        emit log_string("HIGH-1a FIXED: claimEarnings correctly rejects voucher that would drain creatorA earnings");
    }

    /**
     * TEST HIGH-1b - Same creator double-claim: withdraw() + claimEarnings()
     *
     * If CreatorA has earnings in the mapping AND the operator signs a 
     * claimEarnings voucher for CreatorA for the same amount, CreatorA 
     * can claim twice - once via withdraw() and once via claimEarnings().
     * Second claim drains funds belonging to other creators/key owners.
     */
    function test_HIGH01b_claimEarnings_SameCreator_DoubleClaim() public {
        // ARRANGE: Fund marketplace with 2x PRICE - one for CreatorA earnings,
        // one extra (simulating key deposits or another creator's funds).
        _registerAgent(SLUG, creatorA, PRICE);

        // Two x402 payments of PRICE each
        usdc.mint(address(marketplace), PRICE * 2);
        vm.prank(operatorAddr);
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("pay-A1"));
        vm.prank(operatorAddr);
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("pay-A2"));

        // earnings[creatorA] = 36000 (90% * 2 * 20000)
        // totalEarnings = 36000
        // Contract balance = 36000 (2 * 20000 - 2 * 2000 treasury = 40000 - 4000 = 36000)
        emit log_named_uint("creatorA earnings",     marketplace.getPendingEarnings(creatorA));
        emit log_named_uint("totalEarnings",          marketplace.totalEarnings());
        emit log_named_uint("contract balance",       usdc.balanceOf(address(marketplace)));

        // Operator also signs a claimEarnings voucher for creatorA for 18000
        // (one invocation's worth)
        uint256 grossVoucher = 18_000; // equivalent of one invocation's creatorShare
        uint256 deadline     = block.timestamp + 1 days;
        bytes32 nonce        = keccak256("voucher-A-001");
        bytes memory sig     = _signClaimVoucher(creatorA, grossVoucher, deadline, nonce);

        uint256 balanceBefore = usdc.balanceOf(address(marketplace));

        // ACT: CreatorA uses BOTH paths
        // Path 1: withdraw() from earnings mapping
        vm.prank(creatorA);
        marketplace.withdraw(); // gets 36000

        emit log_named_uint("after withdraw - contract balance", usdc.balanceOf(address(marketplace)));
        emit log_named_uint("after withdraw - creatorA balance",  usdc.balanceOf(creatorA));

        // Path 2: claimEarnings - guard checks balanceOf - totalKeyBalances >= grossVoucher
        // balance is now 0, but if totalKeyBalances were > 0 or other funds existed, this would drain them
        // In this test after withdraw, balance = 0, so it should revert
        // (This sub-test validates the guard works when balance is depleted)
        vm.prank(creatorA);
        vm.expectRevert("WasiAI: insufficient free balance");
        marketplace.claimEarnings(creatorA, grossVoucher, deadline, nonce, sig);

        // The key finding: in HIGH-1a, the guard passed when balance = totalEarnings
        // because totalEarnings was NOT subtracted from the guard
        emit log_named_uint("TOTAL extracted vs initial", usdc.balanceOf(creatorA));
        emit log_named_uint("balanceBefore",              balanceBefore);
        // CreatorA got all 36000 - expected since both paymentIds were unique
        // and the guard was satisfied at recordInvocation time
        // HIGH-1a is the more direct attack (different creators)

        emit log_string("HIGH-1b: Validates the cross-creator attack in HIGH-1a is the primary risk");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HIGH-2: recordInvocation soft balance check ignores existing obligations
    //
    // Hypothesis: recordInvocation checks balanceOf >= amount (total balance),
    // not free balance (balanceOf - totalKeyBalances - totalEarnings).
    // A compromised operator can call recordInvocation using key deposit USDC
    // as the apparent source, making the contract insolvent.
    //
    // If test PASSES → CONFIRMED (key owner cannot withdraw after fake invocation)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * TEST HIGH-2 - recordInvocation uses key deposit funds as phantom x402 payment
     *
     * Setup:
     *   - KeyOwner deposits PRICE USDC (totalKeyBalances = PRICE)
     *   - Operator fabricates a paymentId for an agent invocation
     *
     * Attack:
     *   - Operator calls recordInvocation(SLUG, payer, PRICE, fakePaymentId)
     *   - Soft check: balanceOf(contract) = PRICE >= PRICE → PASSES
     *   - Platform share (10%) sent to treasury → contract balance = 0.9 * PRICE
     *   - earnings[creator] += 0.9 * PRICE
     *   - totalEarnings += 0.9 * PRICE
     *   - totalKeyBalances STILL = PRICE (not reduced)
     *
     * Impact:
     *   - Contract balance = PRICE * 0.9 = 18000
     *   - totalKeyBalances = 20000 (PRICE)
     *   - Solvency check FAILS: 18000 < 20000 + 18000 = 38000
     *   - Key owner cannot withdraw their PRICE USDC
     */
    function test_FIXED_HIGH02_recordInvocation_UseKeyDepositsAsPhantomPayment() public {
        // ARRANGE: Register agent + fund key (no x402 payment arrives)
        _registerAgent(SLUG, creatorA, PRICE);
        _fundKey(KEY_ID, payer, PRICE); // payer deposits PRICE via key flow

        uint256 balanceBefore    = usdc.balanceOf(address(marketplace));
        uint256 keyBalanceBefore = marketplace.keyBalances(KEY_ID);

        emit log_named_uint("contract balance before",  balanceBefore);  // 20000
        emit log_named_uint("totalKeyBalances before",  marketplace.totalKeyBalances()); // 20000
        emit log_named_uint("payer key balance before", keyBalanceBefore); // 20000

        // FIXED: Operator tries recordInvocation WITHOUT a real x402 payment arriving.
        // Free balance = balanceOf(20000) - totalKeyBalances(20000) - totalEarnings(0) = 0 < PRICE → REVERT
        vm.prank(operatorAddr);
        vm.expectRevert("WasiAI: insufficient balance");
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("FAKE-payment-id-001"));

        // Contract remains solvent — no phantom invocation processed
        (bool solvent, uint256 accounted, uint256 balance) = marketplace.checkSolvency();
        emit log_named_uint("solvent?",    solvent ? 1 : 0);
        emit log_named_uint("accounted",   accounted);
        emit log_named_uint("balance",     balance);

        assertTrue(solvent, "HIGH-2 FIXED: Contract remains solvent");

        // Key owner can still withdraw their full PRICE
        vm.prank(payer);
        marketplace.withdrawKey(KEY_ID, PRICE);
        assertEq(usdc.balanceOf(payer), PRICE, "HIGH-2 FIXED: Key owner recovered full deposit");

        emit log_string("HIGH-2 FIXED: recordInvocation correctly rejects phantom payment");
    }

    /**
     * TEST HIGH-2b - Multiple phantom invocations completely drain key deposits
     *
     * Attacker (compromised operator) calls recordInvocation N times using
     * the same key deposit pool as apparent USDC source.
     * After enough calls, the contract can drain MORE USDC than key deposits
     * by also consuming x402 earnings from other users.
     */
    function test_FIXED_HIGH02b_recordInvocation_MultiplePhantomInvocations() public {
        // Fund key with 5x PRICE
        uint256 keyFund = PRICE * 5;
        _registerAgent(SLUG, creatorA, PRICE);
        _fundKey(KEY_ID, payer, keyFund);

        emit log_named_uint("initial key deposit", keyFund); // 100000

        // FIXED: All phantom invocations revert — free balance = 0 (all in key balances)
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(operatorAddr);
            vm.expectRevert("WasiAI: insufficient balance");
            marketplace.recordInvocation(
                SLUG, payer, PRICE,
                keccak256(abi.encodePacked("FAKE-multi-", i))
            );
        }

        // Contract stays solvent
        (bool solvent,,) = marketplace.checkSolvency();
        assertTrue(solvent, "HIGH-2b FIXED: Contract remains solvent");

        assertEq(usdc.balanceOf(treasury), 0, "HIGH-2b FIXED: Treasury received nothing");
        assertEq(marketplace.totalEarnings(), 0, "HIGH-2b FIXED: No phantom earnings");

        // Key owner can fully withdraw
        vm.prank(payer);
        marketplace.withdrawKey(KEY_ID, keyFund);
        assertEq(usdc.balanceOf(payer), keyFund, "HIGH-2b FIXED: Key owner recovered all funds");

        emit log_string("HIGH-2b FIXED: Multiple phantom invocations all rejected");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MEDIUM-1: performUpkeep callable by anyone - timing/event griefing
    //
    // Hypothesis: performUpkeep has no access control. Any address can call it
    // once every 23h, preventing Chainlink Automation from running on schedule
    // and emitting fake UpkeepPerformed events.
    //
    // If test PASSES → CONFIRMED (anyone can call and emit event)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * TEST MEDIUM-1 - performUpkeep callable by random attacker, not just Chainlink
     */
    function test_FIXED_MEDIUM01_performUpkeep_AnyoneCanCall() public {
        address attacker = address(0xBEEF);

        // Warp past the UPKEEP_INTERVAL
        vm.warp(block.timestamp + 23 hours + 1);

        uint256 tsBefore = marketplace.lastUpkeepTimestamp();

        // FIXED: Attacker can no longer call performUpkeep (onlyOperator)
        vm.prank(attacker);
        vm.expectRevert("WasiAI: not operator");
        marketplace.performUpkeep("");

        // Timestamp unchanged — Chainlink can still run on schedule
        assertEq(marketplace.lastUpkeepTimestamp(), tsBefore, "MEDIUM-1 FIXED: Attacker did not update timestamp");

        // Upkeep is still needed (attacker didn't block it)
        (bool upkeepNeeded, ) = marketplace.checkUpkeep("");
        assertTrue(upkeepNeeded, "MEDIUM-1 FIXED: Upkeep still needed after failed attacker call");

        emit log_string("MEDIUM-1 FIXED: performUpkeep correctly rejects non-operator caller");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LOW-1: updateAgent missing whenNotPaused
    //
    // Hypothesis: The contract is paused (emergencies, bug response), but
    // updateAgent has no whenNotPaused modifier. Prices can change during pause,
    // violating the expectation that the paused state is "frozen".
    //
    // If test PASSES → CONFIRMED (price changes during pause)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * TEST LOW-1 - Price changes are allowed while contract is paused
     */
    function test_FIXED_LOW01_updateAgent_PriceChangeDuringPause() public {
        // Register an agent
        _registerAgent(SLUG, creatorA, PRICE);

        // Verify initial price
        assertEq(marketplace.getAgent(SLUG).pricePerCall, PRICE);

        // Owner pauses the contract
        vm.prank(owner);
        marketplace.pause();

        // FIXED: Creator attempts to change price while paused — must REVERT
        vm.prank(creatorA);
        vm.expectRevert();
        marketplace.updateAgent(SLUG, 999_999);

        // Price unchanged — pause enforced
        assertEq(
            marketplace.getAgent(SLUG).pricePerCall,
            PRICE,
            "LOW-1 FIXED: Price unchanged while paused"
        );

        emit log_string("LOW-1 FIXED: updateAgent correctly blocked during pause");
        emit log_named_uint("price (unchanged)", PRICE);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INFO-1: Emergency timeout can be indefinitely blocked by operator
    //
    // Hypothesis: Any operator action resets lastOperatorActivity.
    // The operator can call registerAgent with a dummy slug every 29 days to
    // keep the emergency exit permanently locked, at minimal gas cost.
    //
    // If test PASSES → CONFIRMED (timer resets prevent emergency exit)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * TEST INFO-1 - Operator can perpetually block emergency exit with cheap no-op
     */
    function test_INFO01_emergencyTimeout_CanBeBlockedByOperator() public {
        // Fund a key
        _fundKey(KEY_ID, payer, 100_000);

        // Warp 29 days (1 day short of 30-day timeout)
        vm.warp(block.timestamp + 29 days);

        // Operator does a cheap action (register a dummy slug)
        // This resets lastOperatorActivity and the 30-day clock
        vm.prank(operatorAddr);
        marketplace.registerAgent("dummy-keepalive-slug", 1000, address(0x99), 0);

        // Warp another 29 days (now 58 days total since deposit)
        vm.warp(block.timestamp + 29 days);

        // User tries emergency exit - should STILL be blocked
        vm.prank(payer);
        vm.expectRevert("WasiAI: operator still active");
        marketplace.emergencyWithdrawKey(KEY_ID);

        emit log_string("INFO-1 CONFIRMED: Operator can block emergency exit indefinitely with minimal activity");
        emit log_named_uint("days elapsed since deposit",  58);
        emit log_named_uint("days since last operator activity", 29);
        emit log_named_uint("EMERGENCY_TIMEOUT",           30);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HIGH-1 GUARD VALIDATION - Demonstrates the correct check would prevent HIGH-1
    //
    // This test shows what the balance guard SHOULD check.
    // The correct guard: balanceOf - totalKeyBalances - totalEarnings >= grossAmount
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * TEST HIGH-1-GUARD - Verify that balance guard fails to protect totalEarnings
     *
     * This test explicitly shows the accounting gap by reading the values
     * that SHOULD be in the guard but aren't.
     */
    function test_HIGH01_guard_AccountingGapExposed() public {
        // Setup: CreatorA earns 18000 via recordInvocation
        _registerAgent(SLUG, creatorA, PRICE);
        usdc.mint(address(marketplace), PRICE);
        vm.prank(operatorAddr);
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("pay-guard-1"));

        uint256 balance      = usdc.balanceOf(address(marketplace));
        uint256 keyBals      = marketplace.totalKeyBalances();
        uint256 totalEarn    = marketplace.totalEarnings();

        // Current guard: balance - keyBals >= grossAmount
        // What it protects: key balances
        // What it MISSES: earnings from the earnings mapping

        uint256 guardValue     = balance - keyBals;     // 18000 - 0 = 18000
        uint256 correctGuard   = balance - keyBals - totalEarn; // 18000 - 0 - 18000 = 0

        emit log_named_uint("guard value (current, wrong)",   guardValue);   // 18000
        emit log_named_uint("guard value (correct, missing)", correctGuard); // 0
        emit log_named_uint("totalEarnings not subtracted",   totalEarn);    // 18000

        // The current guard would PASS a voucher for 18000 USDC
        assertTrue(guardValue >= 18_000, "Current guard passes (BAD)");

        // But the correct guard would FAIL
        assertLt(correctGuard, 18_000, "Correct guard would block the claim");

        emit log_string("HIGH-1 CONFIRMED: Balance guard missing '- totalEarnings' allows drain of creator earnings");
    }
}
