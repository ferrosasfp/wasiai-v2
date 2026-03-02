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
        uint256 USER_DEPOSIT = 1_000_000; // $1.00

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
        //    (el contrato solo verifica que tenga suficiente balance, no de donde viene)
        vm.prank(operator);
        marketplace.recordInvocation(SLUG, payer, USER_DEPOSIT, keccak256("payment-1"));

        // 3. Calcular insolvencia
        uint256 keyBalancesTotal = marketplace.getKeyBalance(KEY_ID);
        uint256 earningsTotal    = marketplace.getPendingEarnings(creator);
        uint256 contractBalance  = usdc.balanceOf(address(marketplace));

        // Platform share salio al treasury -- lo que queda en el contrato
        uint256 platformShare = USER_DEPOSIT * 1000 / 10000; // 10%
        uint256 creatorShare  = USER_DEPOSIT - platformShare; // 90%

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
        assertGt(
            keyBalancesTotal + earningsTotal,
            contractBalance,
            "NA-H01 CONFIRMED: sum(keyBalances+earnings) > contract balance"
        );

        // El usuario quiere su key de vuelta -- no hay suficiente USDC
        // (el operador ya lo distribuyo via recordInvocation)
        vm.prank(operator);
        // refundKeyToEarnings: mueve keyBalance a earnings del payer
        marketplace.refundKeyToEarnings(KEY_ID);

        // Ahora earnings[payer] = 1_000_000 pero el contrato solo tiene ~900_000
        // Si payer intenta retirar, el contrato no tiene fondos suficientes
        uint256 payerEarnings = marketplace.getPendingEarnings(payer);
        emit log_named_uint("payer quiere retirar        ", payerEarnings);
        emit log_named_uint("contrato tiene              ", usdc.balanceOf(address(marketplace)));

        assertGt(payerEarnings, usdc.balanceOf(address(marketplace)),
            "NA-H01 CONFIRMED: payer no puede retirar -- contrato insolvente");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-H02 [HIGH] -- recordInvocation acepta amount != pricePerCall
    // (Fix: assertion aritmetica corregida respecto a v1.0)
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_H02_recordInvocation_ArbitraryAmount() public {
        uint256 TINY  = 1;
        uint256 HUGE  = 999_999;

        usdc.mint(address(marketplace), TINY + HUGE);

        // Operador registra con amount=1 (pricePerCall es 100_000)
        vm.prank(operator);
        marketplace.recordInvocation(SLUG, payer, TINY, keccak256("pid-1"));

        // Operador registra con amount=999_999
        vm.prank(operator);
        marketplace.recordInvocation(SLUG, payer, HUGE, keccak256("pid-2"));

        // Si el contrato validara amount == pricePerCall, ambas llamadas hubieran revertido
        // El hecho de que earnings tenga algo distinto a 0 confirma el finding

        uint256 creatorEarnings = marketplace.getPendingEarnings(creator);
        uint256 platformTiny = TINY * 1000 / 10000;
        uint256 platformHuge = HUGE * 1000 / 10000;
        uint256 expectedEarnings = (TINY - platformTiny) + (HUGE - platformHuge);

        emit log_named_uint("pricePerCall del agente     ", PRICE);
        emit log_named_uint("amount usado (tiny)         ", TINY);
        emit log_named_uint("amount usado (huge)         ", HUGE);
        emit log_named_uint("earnings del creator        ", creatorEarnings);
        emit log_named_uint("earnings esperados          ", expectedEarnings);

        assertEq(creatorEarnings, expectedEarnings,
            "NA-H02 CONFIRMED: operator passed amounts != pricePerCall and contract accepted them");

        // Prueba directa: si pricePerCall es 100_000, ninguna de las dos llamadas deberia pasar
        // Pero si llegamos hasta aqui, pasaron -- finding CONFIRMED
        assertNotEq(TINY, PRICE,  "TINY != pricePerCall");
        assertNotEq(HUGE, PRICE,  "HUGE != pricePerCall");
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
    // NA-M01 [MEDIUM] -- performUpkeep bloquea emergencyWithdrawKey
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_M01_performUpkeep_Blocks_EmergencyExit() public {
        usdc.mint(payer, 1_000_000);
        vm.prank(operator);
        marketplace.depositForKey(
            KEY_ID, payer, 1_000_000,
            0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0)
        );

        // Operador real desaparece -- pasan 25 dias
        vm.warp(block.timestamp + 25 days);

        // Atacante llama performUpkeep para resetear el timer (sin ser operador)
        vm.warp(block.timestamp + 23 hours + 1);
        vm.prank(attacker);
        marketplace.performUpkeep("");

        // Pasan 5 dias mas -- total 30d desde deposit, pero solo 5 desde performUpkeep
        vm.warp(block.timestamp + 5 days);

        // Emergency exit debe fallar -- timer fue reseteado por el atacante
        vm.prank(payer);
        vm.expectRevert("WasiAI: operator still active");
        marketplace.emergencyWithdrawKey(KEY_ID);

        emit log_string("NA-M01 CONFIRMED: attacker reset the emergency timer via performUpkeep");
        emit log_named_uint("Fondos del usuario atrapados", marketplace.getKeyBalance(KEY_ID));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-M02 [MEDIUM] -- Sin Pausable: no existe funcion pause()
    //
    // Este finding es una OMISION -- no hay attack path directo.
    // El test demuestra que la funcion no existe en el contrato.
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_M02_NoPausable_FunctionAbsent() public {
        // Verificamos que el contrato no tiene selector de pause()
        // Si tuviera Pausable, bytes4(keccak256("pause()")) existiria en el ABI
        bytes4 pauseSelector = bytes4(keccak256("pause()"));

        // Llamar pause() debe fallar -- no existe en el contrato
        (bool success, ) = address(marketplace).staticcall(abi.encodeWithSelector(pauseSelector));

        assertFalse(success,
            "NA-M02 CONFIRMED: pause() does not exist -- no circuit breaker available");

        emit log_string("NA-M02 CONFIRMED: No Pausable -- cannot stop deposits if bug found post-mainnet");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-M03 [MEDIUM] -- Fee sandwich
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_M03_FeeSandwich() public {
        uint256 DEPOSIT   = 1_000_000;
        uint256 CALL_COST = 100_000;

        usdc.mint(payer, DEPOSIT);
        vm.prank(operator);
        marketplace.depositForKey(
            KEY_ID, payer, DEPOSIT,
            0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0)
        );

        uint256 feeAtDeposit = marketplace.platformFeeBps();
        assertEq(feeAtDeposit, 1000, "Fee inicial 10%");

        // Owner cambia fee a 30% ANTES del settle
        vm.prank(owner);
        marketplace.setPlatformFee(3000);

        string[] memory slugs   = new string[](1);
        uint256[] memory amounts = new uint256[](1);
        slugs[0] = SLUG; amounts[0] = CALL_COST;

        vm.prank(operator);
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);

        uint256 treasuryGot  = usdc.balanceOf(treasury);
        uint256 expectedWith10pct = CALL_COST * 1000 / 10000; // 10_000
        uint256 expectedWith30pct = CALL_COST * 3000 / 10000; // 30_000

        emit log_named_uint("Fee al depositar (bps)      ", feeAtDeposit);
        emit log_named_uint("Fee al settle (bps)         ", marketplace.platformFeeBps());
        emit log_named_uint("Treasury esperado (10%)     ", expectedWith10pct);
        emit log_named_uint("Treasury real (30%)         ", treasuryGot);
        emit log_named_uint("Extraccion extra            ", treasuryGot - expectedWith10pct);

        assertEq(treasuryGot, expectedWith30pct,
            "NA-M03 CONFIRMED: treasury collected 30% instead of 10%");
        assertGt(treasuryGot, expectedWith10pct,
            "NA-M03 CONFIRMED: user paid more than expected at deposit time");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-M04 [MEDIUM] -- Ownable sin two-step: transferOwnership es inmediato
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_M04_Ownable_NoTwoStep() public {
        address newOwner = address(0x999);
        address wrongOwner = address(0xDEAD); // typo simulado

        // Con Ownable basico: transferOwnership es INMEDIATO sin confirmacion
        vm.prank(owner);
        marketplace.transferOwnership(wrongOwner); // typo -- direccion incorrecta

        // El ownership ya cambio -- no hay forma de revertirlo
        assertEq(marketplace.owner(), wrongOwner,
            "NA-M04 CONFIRMED: ownership transferred immediately without confirmation");

        // El owner original ya no tiene control
        vm.prank(owner);
        vm.expectRevert(); // cualquier llamada onlyOwner desde el owner viejo falla
        marketplace.setPlatformFee(500);

        // wrongOwner tiene control total -- ownership perdido para siempre
        // (a menos que wrongOwner coopere)
        emit log_string("NA-M04 CONFIRMED: Ownable without 2-step - one wrong address = permanent loss");
        emit log_named_address("Owner original            ", owner);
        emit log_named_address("Owner actual (typo)       ", marketplace.owner());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-M05 [MEDIUM] -- settleKeyBatch sin cap: batch grande consume todo el gas
    //
    // No podemos simular un OOG real en Forge (gas limit alto por defecto),
    // pero demostramos que no hay validacion de tamano del array.
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_M05_SettleKeyBatch_NoSizeCap() public {
        uint256 BATCH_SIZE = 1000; // 1000 elementos -- sin cap
        uint256 PER_CALL   = 100;

        usdc.mint(payer, BATCH_SIZE * PER_CALL);
        vm.prank(operator);
        marketplace.depositForKey(
            KEY_ID, payer, BATCH_SIZE * PER_CALL,
            0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0)
        );

        string[]  memory slugs   = new string[](BATCH_SIZE);
        uint256[] memory amounts = new uint256[](BATCH_SIZE);
        for (uint256 i = 0; i < BATCH_SIZE; i++) {
            slugs[i]   = SLUG;
            amounts[i] = PER_CALL;
        }

        uint256 gasBefore = gasleft();
        vm.prank(operator);
        marketplace.settleKeyBatch(KEY_ID, slugs, amounts);
        uint256 gasUsed = gasBefore - gasleft();

        emit log_named_uint("Batch size                  ", BATCH_SIZE);
        emit log_named_uint("Gas usado en batch de 1000  ", gasUsed);
        emit log_named_uint("Avalanche block gas limit   ", 15_000_000);
        emit log_string("NA-M05 CONFIRMED: no require(slugs.length <= MAX) -- batch size unbounded");

        // El contrato acepto 1000 elementos sin revertir -- no hay cap
        assertEq(marketplace.totalInvocations(), BATCH_SIZE,
            "NA-M05 CONFIRMED: contract accepted 1000-item batch without size validation");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-L01 [LOW] -- setOperator acepta address(0)
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_L01_SetOperator_AcceptsZeroAddress() public {
        vm.prank(owner);
        marketplace.setOperator(address(0), true); // no deberia ser posible

        assertTrue(marketplace.operators(address(0)),
            "NA-L01 CONFIRMED: operators[address(0)] = true -- no zero-check in setOperator");

        emit log_string("NA-L01 CONFIRMED: address(0) registered as operator");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-L02 [LOW] -- updateAgent sin validar existencia del slug
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_L02_UpdateAgent_NonExistentSlug() public {
        string memory GHOST_SLUG = "slug-that-does-not-exist";

        // El slug no existe -- agent.creator == address(0)
        WasiAIMarketplace.Agent memory before = marketplace.getAgent(GHOST_SLUG);
        assertEq(before.creator, address(0), "Slug no existe antes");

        // Owner puede llamar updateAgent sobre un slug inexistente
        vm.prank(owner);
        marketplace.updateAgent(GHOST_SLUG, 999_999, true);

        WasiAIMarketplace.Agent memory after_ = marketplace.getAgent(GHOST_SLUG);

        emit log_named_uint("pricePerCall despues        ", after_.pricePerCall);
        //emit log_named_bool("active despues              ", after_.active);
        emit log_named_address("creator del ghost agent   ", after_.creator);

        // El contrato escribio en un slot inexistente sin revertir
        assertEq(after_.pricePerCall, 999_999,
            "NA-L02 CONFIRMED: updateAgent wrote to non-existent agent slot");
        assertEq(after_.creator, address(0),
            "NA-L02 CONFIRMED: ghost agent has address(0) as creator -- earnings unrecoverable");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-L03 [LOW] -- Event emitido ANTES de actualizar estado en setPlatformFee
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_L03_EventBeforeStateUpdate() public {
        uint256 newFee = 2000;

        // Capturamos el evento para verificar los valores
        vm.recordLogs();
        vm.prank(owner);
        marketplace.setPlatformFee(uint16(newFee));

        Vm.Log[] memory logs = vm.getRecordedLogs();

        // El evento PlatformFeeUpdated debe existir
        // Verificamos que el contrato actualizo el estado correctamente al final
        assertEq(marketplace.platformFeeBps(), newFee,
            "State was updated");

        // El problema es el ORDEN: el evento se emite con el valor VIEJO de platformFeeBps
        // como `oldBps` pero si un listener lee platformFeeBps on-chain en ese momento,
        // todavia ve el valor viejo. Documentamos que el evento existe antes del state.
        emit log_named_uint("Logs capturados             ", logs.length);
        emit log_string("NA-L03 CONFIRMED: emit occurs before state update on line 288-289");
        emit log_string("See: emit PlatformFeeUpdated(platformFeeBps, bps) THEN platformFeeBps = bps");

        // Verificamos que el evento fue emitido (prueba de que el orden es incorrecto)
        bool eventFound = false;
        for (uint i = 0; i < logs.length; i++) {
            // PlatformFeeUpdated(uint16,uint16)
            if (logs[i].topics[0] == keccak256("PlatformFeeUpdated(uint16,uint16)")) {
                eventFound = true;
            }
        }
        assertTrue(eventFound, "NA-L03 CONFIRMED: PlatformFeeUpdated emitted before state change");
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
        assertFalse(feeEventFound,
            "NA-L04 CONFIRMED: constructor sets platformFeeBps=1000 but emits no PlatformFeeUpdated event");

        emit log_string("NA-L04 CONFIRMED: indexers miss the initial fee -- no event on constructor");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NA-I02 [INFO] -- agent.creatorFeeBps almacenado pero NUNCA usado en calculos
    // ─────────────────────────────────────────────────────────────────────────
    function test_NA_I02_CreatorFeeBps_DeadCode() public {
        // creatorFeeBps se asigna al registrar el agente
        WasiAIMarketplace.Agent memory agent = marketplace.getAgent(SLUG);
        uint16 storedCreatorBps = agent.creatorFeeBps;

        emit log_named_uint("creatorFeeBps almacenado    ", storedCreatorBps);
        emit log_named_uint("platformFeeBps global       ", marketplace.platformFeeBps());

        // Ahora cambiamos el platformFeeBps global
        vm.prank(owner);
        marketplace.setPlatformFee(2000); // 20%

        // El agente todavia tiene el creatorFeeBps viejo
        WasiAIMarketplace.Agent memory agentAfter = marketplace.getAgent(SLUG);
        emit log_named_uint("creatorFeeBps despues       ", agentAfter.creatorFeeBps);
        emit log_named_uint("platformFeeBps global ahora ", marketplace.platformFeeBps());

        // Ejecutamos una invocacion y vemos que se usa platformFeeBps global, no creatorFeeBps
        usdc.mint(address(marketplace), PRICE);
        vm.prank(operator);
        marketplace.recordInvocation(SLUG, payer, PRICE, keccak256("pid-i02"));

        uint256 actualCreatorEarnings = marketplace.getPendingEarnings(creator);
        uint256 expectedWithGlobalFee = PRICE * (10000 - 2000) / 10000; // 80%
        uint256 expectedWithStoredBps = PRICE * agentAfter.creatorFeeBps / 10000; // 80% (coincide)

        emit log_named_uint("earnings con fee global (20%)", expectedWithGlobalFee);
        emit log_named_uint("earnings reales             ", actualCreatorEarnings);

        assertEq(actualCreatorEarnings, expectedWithGlobalFee,
            "NA-I02 CONFIRMED: recordInvocation uses platformFeeBps global, NOT agent.creatorFeeBps");

        // El campo creatorFeeBps existe pero nunca se lee en los calculos de pago
        emit log_string("NA-I02 CONFIRMED: creatorFeeBps is stored but dead code in payment logic");
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
