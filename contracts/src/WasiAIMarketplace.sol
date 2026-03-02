// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @notice ERC-3009: Token Transfer With Authorization
 * @dev Used for gasless USDC transfers (Circle's USDC implements this)
 */
interface IERC3009 {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/**
 * @title  WasiAIMarketplace
 * @notice Agent-to-agent marketplace with x402 payment accounting.
 *
 * Flow:
 *   1. Creator registers agent (via backend operator)
 *   2. Caller (human or AI agent) pays USDC to this contract via x402
 *      (Ultravioleta DAO facilitator executes transferWithAuthorization)
 *   3. Backend operator calls recordInvocation() → splits earnings
 *   4. Creator calls withdraw() to claim their USDC anytime
 *
 * Key Flow (pre-funded):
 *   1. User deposits USDC via depositForKey() (ERC-3009 gasless)
 *   2. Each call deducts from keyBalances (tracked in DB, batch settled daily)
 *   3. Operator calls settleKeyBatch() once/day for all calls
 *   4. User can close key via refundKeyToEarnings() (operator) or
 *      emergencyWithdrawKey() (trustless exit after 30d inactivity)
 *
 * Fee model:
 *   - Default: 10% to WasiAI treasury, 90% to agent creator
 *   - Adjustable by owner (max 30%)
 *   - Early creator program: set fee to 0% for specific creators
 *
 * @dev Deployed on Avalanche C-Chain (chainId: 43114)
 *      USDC: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
 */
contract WasiAIMarketplace is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── Types ────────────────────────────────────────────────────────────────

    struct Agent {
        address creator;          // wallet that receives earnings
        uint256 pricePerCall;     // USDC in atomic units (6 decimals). e.g. 20000 = $0.02
        uint64  erc8004Id;        // ERC-8004 identity token ID (0 = not registered)
        uint16  creatorFeeBps;    // creator's share in bps (default: 9000 = 90%)
        bool    active;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20  public immutable usdc;
    address public           treasury;
    uint16  public           platformFeeBps = 1000; // 10% default

    /// slug → Agent
    mapping(string  => Agent)   public agents;
    /// creator wallet → claimable USDC (atomic units)
    mapping(address => uint256) public earnings;
    /// trusted backend operators (can call registerAgent / recordInvocation)
    mapping(address => bool)    public operators;

    uint256 public totalVolume;   // lifetime USDC volume (atomic units)
    uint256 public totalInvocations;

    /// keyId (bytes32 from SHA-256 key_hash) → on-chain USDC balance
    mapping(bytes32 => uint256) public keyBalances;
    /// keyId → address that can withdraw the key's remaining balance
    mapping(bytes32 => address) public keyOwners;

    /// paymentId → already recorded (idempotency guard for recordInvocation)
    mapping(bytes32 => bool) public usedPaymentIds;

    /// Timestamp of the last operator activity.
    /// If > EMERGENCY_TIMEOUT has passed, key owners can exit trustlessly.
    uint256 public lastOperatorActivity;

    /// 30 days without operator activity → users can emergency-withdraw
    uint256 public constant EMERGENCY_TIMEOUT = 30 days;

    /// Timestamp del último upkeep ejecutado por Chainlink Automation
    uint256 public lastUpkeepTimestamp;

    /// Intervalo mínimo entre upkeeps (23h para no chocar con el cron diario de 02:00 UTC)
    uint256 public constant UPKEEP_INTERVAL = 23 hours;

    // ─── Events ───────────────────────────────────────────────────────────────

    event AgentRegistered(
        string  indexed slug,
        address indexed creator,
        uint256 pricePerCall,
        uint64  erc8004Id
    );
    event AgentUpdated(string indexed slug, uint256 newPrice, bool active);
    event AgentInvoked(
        string  indexed slug,
        address indexed payer,
        uint256 amount,
        uint256 creatorShare,
        uint256 platformShare
    );
    event Withdrawn(address indexed creator, uint256 amount);
    event PlatformFeeUpdated(uint16 oldBps, uint16 newBps);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event OperatorSet(address indexed operator, bool active);

    /// @notice Emitido cuando Chainlink Automation ejecuta performUpkeep
    event UpkeepPerformed(uint256 indexed timestamp, address indexed performer);

    // ── Pre-funded Key Events ────────────────────────────────────────────────
    event KeyFunded(bytes32 indexed keyId, address indexed owner, uint256 amount);
    event KeyCallSettled(bytes32 indexed keyId, string slug, uint256 amount, uint256 creatorShare, uint256 platformShare);
    event KeyRefunded(bytes32 indexed keyId, address indexed owner, uint256 amount);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOperator() {
        require(
            operators[msg.sender] || msg.sender == owner(),
            "WasiAI: not operator"
        );
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _usdc, address _treasury) Ownable(msg.sender) {
        require(_usdc     != address(0), "WasiAI: zero USDC");
        require(_treasury != address(0), "WasiAI: zero treasury");
        usdc     = IERC20(_usdc);
        treasury = _treasury;
        operators[msg.sender] = true;
        lastOperatorActivity  = block.timestamp;
        lastUpkeepTimestamp   = block.timestamp;
        emit PlatformFeeUpdated(0, platformFeeBps);
    }

    // ─── Agent Registry ───────────────────────────────────────────────────────

    /**
     * @notice Register a new agent in the marketplace.
     * @dev Called by the backend operator when a creator publishes an agent.
     *      pricePerCall is in USDC atomic units (6 decimals).
     *      e.g. $0.02 = 20000
     */
    function registerAgent(
        string  calldata slug,
        uint256 pricePerCall,
        address creator,
        uint64  erc8004Id
    ) external onlyOperator {
        lastOperatorActivity = block.timestamp;
        require(bytes(slug).length > 0, "WasiAI: empty slug");
        require(creator != address(0),  "WasiAI: zero creator");
        require(
            agents[slug].creator == address(0),
            "WasiAI: slug taken"
        );

        agents[slug] = Agent({
            creator:       creator,
            pricePerCall:  pricePerCall,
            erc8004Id:     erc8004Id,
            creatorFeeBps: uint16(10_000 - platformFeeBps), // e.g. 9000
            active:        true
        });

        emit AgentRegistered(slug, creator, pricePerCall, erc8004Id);
    }

    /**
     * @notice Update agent price or status.
     * @dev Callable by the creator themselves or by an operator.
     */
    function updateAgent(
        string  calldata slug,
        uint256 newPrice,
        bool    active
    ) external {
        Agent storage agent = agents[slug];
        require(agent.creator != address(0), "WasiAI: agent not found");
        require(
            agent.creator == msg.sender ||
            operators[msg.sender]       ||
            msg.sender == owner(),
            "WasiAI: not authorized"
        );
        agent.pricePerCall = newPrice;
        agent.active       = active;
        emit AgentUpdated(slug, newPrice, active);
    }

    // ─── Payment Accounting ───────────────────────────────────────────────────

    /**
     * @notice Record an invocation and split earnings.
     * @dev Called by the backend AFTER the x402 USDC payment has been confirmed
     *      on-chain (Ultravioleta DAO facilitator settles to this contract address).
     *      The `amount` of USDC must already be in this contract.
     *
     * @param slug   Agent slug
     * @param payer  Address that paid (human wallet or AI agent wallet)
     * @param amount USDC amount in atomic units (must match agent.pricePerCall)
     */
    function recordInvocation(
        string  calldata slug,
        address          payer,
        uint256          amount,
        bytes32          paymentId
    ) external onlyOperator nonReentrant {
        lastOperatorActivity = block.timestamp;
        require(!usedPaymentIds[paymentId], "WasiAI: payment already recorded");
        usedPaymentIds[paymentId] = true;

        Agent storage agent = agents[slug];
        require(agent.active,  "WasiAI: agent inactive");
        require(amount > 0,    "WasiAI: zero amount");
        require(amount == agent.pricePerCall, "WasiAI: amount mismatch");

        // Verify contract actually holds the funds
        // (soft check — if the operator is trusted this is just defensive)
        require(
            usdc.balanceOf(address(this)) >= amount,
            "WasiAI: insufficient balance"
        );

        uint256 platformShare = (amount * platformFeeBps) / 10_000;
        uint256 creatorShare  = amount - platformShare;

        // Accumulate creator earnings (pull pattern — creator withdraws when ready)
        earnings[agent.creator] += creatorShare;

        // Send platform share immediately to treasury
        if (platformShare > 0) {
            usdc.safeTransfer(treasury, platformShare);
        }

        totalVolume      += amount;
        totalInvocations += 1;

        emit AgentInvoked(slug, payer, amount, creatorShare, platformShare);
    }

    // ─── Creator Withdrawal ───────────────────────────────────────────────────

    /**
     * @notice Creator claims all pending USDC earnings.
     */
    function withdraw() external nonReentrant {
        uint256 amount = earnings[msg.sender];
        require(amount > 0, "WasiAI: nothing to withdraw");

        earnings[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Operator-triggered withdrawal on behalf of a creator.
     * @dev Useful for automatic payouts triggered by the backend.
     */
    function withdrawFor(address creator) external onlyOperator nonReentrant {
        lastOperatorActivity = block.timestamp;
        uint256 amount = earnings[creator];
        require(amount > 0, "WasiAI: nothing to withdraw");

        earnings[creator] = 0;
        usdc.safeTransfer(creator, amount);

        emit Withdrawn(creator, amount);
    }

    // ─── Pre-funded API Key Flows ─────────────────────────────────────────────

    /**
     * @notice Fund an API key with USDC via ERC-3009 transferWithAuthorization.
     * @dev Operator calls this after user signs the ERC-3009 authorization off-chain.
     *      USDC is transferred from the user directly to this contract.
     * @param keyId  bytes32 derived from SHA-256 of the raw API key (hex string → bytes32)
     * @param owner  User wallet address (must have signed the ERC-3009 authorization)
     * @param amount USDC amount in atomic units (6 decimals)
     */
    function depositForKey(
        bytes32 keyId,
        address owner,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8   v,
        bytes32 r,
        bytes32 s
    ) external onlyOperator nonReentrant whenNotPaused {
        lastOperatorActivity = block.timestamp;
        require(keyId  != bytes32(0), "WasiAI: zero keyId");
        require(owner  != address(0), "WasiAI: zero owner");
        require(amount > 0,           "WasiAI: zero amount");

        IERC3009(address(usdc)).transferWithAuthorization(
            owner, address(this), amount,
            validAfter, validBefore, nonce, v, r, s
        );

        keyBalances[keyId] += amount;
        if (keyOwners[keyId] == address(0)) {
            keyOwners[keyId] = owner;
        }

        emit KeyFunded(keyId, owner, amount);
    }

    /**
     * @notice Liquida un batch de llamadas de key en una sola tx.
     * @dev Gas amortizado: una tx cubre cientos de llamadas.
     *      slugs[i] y amounts[i] corresponden 1-a-1.
     *      El balance total se deduce primero para evitar reentrancy parcial.
     */
    function settleKeyBatch(
        bytes32          keyId,
        string[] calldata slugs,
        uint256[] calldata amounts
    ) external onlyOperator nonReentrant whenNotPaused {
        lastOperatorActivity = block.timestamp;
        require(slugs.length == amounts.length, "WasiAI: length mismatch");
        require(slugs.length > 0,               "WasiAI: empty batch");
        require(slugs.length <= 500,            "WasiAI: batch too large");

        // Compute total first — fail early if insufficient balance
        uint256 total = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
        }
        require(keyBalances[keyId] >= total, "WasiAI: insufficient key balance");

        // Deduct full amount atomically before any transfers (reentrancy-safe)
        keyBalances[keyId] -= total;

        uint256 totalPlatformShare = 0;
        for (uint256 i = 0; i < slugs.length; i++) {
            require(amounts[i] > 0,          "WasiAI: zero amount");
            Agent storage agent = agents[slugs[i]];
            require(agent.active,            "WasiAI: agent inactive");

            uint256 platformShare = (amounts[i] * platformFeeBps) / 10_000;
            uint256 creatorShare  = amounts[i] - platformShare;

            earnings[agent.creator] += creatorShare;
            totalPlatformShare     += platformShare;

            totalVolume      += amounts[i];
            totalInvocations += 1;

            emit KeyCallSettled(keyId, slugs[i], amounts[i], creatorShare, platformShare);
        }

        // Single transfer to treasury after loop — avoids gas blowup in large batches
        if (totalPlatformShare > 0) {
            usdc.safeTransfer(treasury, totalPlatformShare);
        }
    }

    /**
     * @notice Mueve el balance restante de una key a earnings del owner.
     * @dev Operador llama esto cuando el usuario cierra su key.
     *      El owner luego usa withdraw() como cualquier creator.
     */
    function refundKeyToEarnings(bytes32 keyId) external onlyOperator nonReentrant {
        lastOperatorActivity = block.timestamp;
        require(keyOwners[keyId] != address(0), "WasiAI: unknown key");
        uint256 amount = keyBalances[keyId];
        require(amount > 0, "WasiAI: nothing to refund");

        keyBalances[keyId] = 0;
        earnings[keyOwners[keyId]] += amount;

        emit KeyRefunded(keyId, keyOwners[keyId], amount);
    }

    /**
     * @notice Salida de emergencia: usuario recupera su USDC si el operador
     *         lleva más de EMERGENCY_TIMEOUT sin actividad.
     * @dev Trustless exit — no requiere permiso del operador.
     */
    function emergencyWithdrawKey(bytes32 keyId) external nonReentrant {
        require(
            block.timestamp > lastOperatorActivity + EMERGENCY_TIMEOUT,
            "WasiAI: operator still active"
        );
        require(keyOwners[keyId] == msg.sender, "WasiAI: not key owner");

        uint256 amount = keyBalances[keyId];
        require(amount > 0, "WasiAI: nothing to withdraw");

        keyBalances[keyId] = 0;
        usdc.safeTransfer(msg.sender, amount);

        emit KeyRefunded(keyId, msg.sender, amount);
    }

    /**
     * @notice View key on-chain USDC balance.
     */
    function getKeyBalance(bytes32 keyId) external view returns (uint256) {
        return keyBalances[keyId];
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /**
     * @notice Update the platform fee for all future invocations.
     * @dev Only callable by the contract owner (WasiAI operator).
     *      Fee is applied to all new invocations after the change.
     *      Existing pending earnings are NOT retroactively affected.
     *
     *      Fee model:
     *      - Default: 1000 bps = 10% to treasury, 90% to creator
     *      - Early creator program: set creatorFeeBps = 10000 on specific agents (0% platform fee)
     *      - Maximum allowed: 3000 bps = 30%
     *
     *      To change: call setPlatformFee(bps) from the owner wallet.
     *      Example: setPlatformFee(1500) → 15% platform fee, 85% to creator.
     *
     * @param bps New platform fee in basis points (100 bps = 1%). Max: 3000 (30%).
     */
    function setPlatformFee(uint16 bps) external onlyOwner {
        require(bps <= 3000, "WasiAI: max 30%");
        uint16 oldBps = platformFeeBps;
        platformFeeBps = bps;
        emit PlatformFeeUpdated(oldBps, bps);
    }

    /// @notice Pause deposits and batch settlement. Emergency use only.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the contract.
    function unpause() external onlyOwner {
        _unpause();
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "WasiAI: zero treasury");
        address oldTreasury = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(oldTreasury, _treasury);
    }

    function setOperator(address operator, bool active) external onlyOwner {
        require(operator != address(0), "WasiAI: zero operator");
        operators[operator] = active;
        emit OperatorSet(operator, active);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getAgent(string calldata slug)
        external view returns (Agent memory)
    {
        return agents[slug];
    }

    function getPendingEarnings(address creator)
        external view returns (uint256)
    {
        return earnings[creator];
    }

    // ─── Chainlink Automation ─────────────────────────────────────────────────

    /// @notice Chainlink Automation compatible — checkUpkeep
    /// @dev Retorna true si han pasado >= UPKEEP_INTERVAL desde el último upkeep.
    ///      No requiere checkData — se ignora.
    function checkUpkeep(bytes calldata /* checkData */)
        external
        view
        returns (bool upkeepNeeded, bytes memory /* performData */)
    {
        upkeepNeeded = (block.timestamp - lastUpkeepTimestamp) >= UPKEEP_INTERVAL;
    }

    /// @notice Chainlink Automation compatible — performUpkeep
    /// @dev Emite UpkeepPerformed y actualiza lastUpkeepTimestamp.
    ///      El settlement real sigue ejecutándose desde el operador backend.
    ///      Cualquier address puede llamar performUpkeep — el intervalo protege
    ///      de abuso (solo ejecutable cada 23h máximo).
    function performUpkeep(bytes calldata /* performData */) external {
        require(
            (block.timestamp - lastUpkeepTimestamp) >= UPKEEP_INTERVAL,
            "WasiAI: upkeep not needed"
        );
        lastUpkeepTimestamp = block.timestamp;
        emit UpkeepPerformed(block.timestamp, msg.sender);
    }

    /// @notice Returns platform stats
    function getStats()
        external view returns (uint256 volume, uint256 invocations, uint16 feeBps)
    {
        return (totalVolume, totalInvocations, platformFeeBps);
    }
}
