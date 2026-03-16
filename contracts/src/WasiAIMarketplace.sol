// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {AutomationCompatibleInterface} from "@chainlink/contracts/src/v0.8/automation/interfaces/AutomationCompatibleInterface.sol";

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
contract WasiAIMarketplace is Ownable2Step, ReentrancyGuard, Pausable, AutomationCompatibleInterface, EIP712 {
    using SafeERC20 for IERC20;

    // ─── Types ────────────────────────────────────────────────────────────────

    struct Agent {
        address creator;          // wallet that receives earnings
        uint256 pricePerCall;     // USDC in atomic units (6 decimals). e.g. 20000 = $0.02
        uint64  erc8004Id;        // ERC-8004 identity token ID (0 = not registered)
        // NA-207: creatorFeeBps removido — dead storage. Fee calculado dinámicamente como (10_000 - platformFeeBps)
        // WAS-161: active removido — status se controla en Supabase (backend filtra antes de llegar al contrato)
    }

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20  public immutable usdc;
    address public           treasury;
    uint16  public           platformFeeBps = 1000; // 10% default

    // NA-301: Registration fee in USDC atomics (6 decimals)
    uint256 public registrationFee;

    // NA-301b: Free registrations per user (default 2), then fee applies
    uint256 public freeRegistrationsPerUser = 2;
    mapping(address => uint256) public userRegistrationCount;

    // ── Fee Timelock (NA-M03) ─────────────────────────────────────────────────
    uint16  public pendingFeeBps;
    uint256 public pendingFeeTimestamp;
    uint256 public constant FEE_TIMELOCK = 48 hours;

    // NA-202: Treasury timelock — mismo patrón que fee
    address public pendingTreasury;
    uint256 public pendingTreasuryTimestamp;
    uint256 public constant TREASURY_TIMELOCK = 48 hours;

    /// slug → Agent
    mapping(string  => Agent)   public agents;
    /// creator wallet → claimable USDC (atomic units)
    mapping(address => uint256) public earnings;
    /// trusted backend operators (can call registerAgent / recordInvocation)
    mapping(address => bool)    public operators;

    uint256 public totalVolume;   // lifetime USDC volume (atomic units)
    uint256 public totalInvocations;

    // ── Solvency Counters (NA-H01) ────────────────────────────────────────────
    /// @notice Sum of all keyBalances -- updated on every key operation
    uint256 public totalKeyBalances;
    /// @notice Sum of all pending earnings -- updated on every earnings operation
    uint256 public totalEarnings;

    // ── Daily Settlement Cap (WAS-94 / SHK-ATTACKER) ─────────────────────────
    /// @notice Max USDC that can be settled in a 24h window (6 decimals)
    uint256 public dailySettlementCap;
    /// @notice USDC settled in the current 24h window
    uint256 public dailySettledAmount;
    /// @notice Timestamp when the current 24h window started
    uint256 public dailySettlementReset;

    /// keyId (bytes32 from SHA-256 key_hash) → on-chain USDC balance
    mapping(bytes32 => uint256) public keyBalances;
    /// keyId → address that can withdraw the key's remaining balance
    mapping(bytes32 => address) public keyOwners;

    /// paymentId → already recorded (idempotency guard for recordInvocation)
    mapping(bytes32 => bool) public usedPaymentIds;

    /// nonce → already used (idempotency guard for claimEarnings)
    mapping(bytes32 => bool) public usedVouchers;

    /// EIP-712 typehash for ClaimEarnings voucher
    bytes32 private constant CLAIM_TYPEHASH = keccak256(
        "ClaimEarnings(address creator,uint256 grossAmount,uint256 deadline,bytes32 nonce)"
    );

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
    event AgentUpdated(string indexed slug, uint256 newPrice);
    event AgentInvoked(
        string  indexed slug,
        address indexed payer,
        uint256 amount,
        uint256 creatorShare,
        uint256 platformShare
    );
    event Withdrawn(address indexed creator, uint256 amount);
    event PlatformFeeUpdated(uint16 oldBps, uint16 newBps);
    event FeeProposed(uint16 indexed newBps, uint256 executeAfter);
    event FeeCanceled(uint16 indexed canceledBps);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event TreasuryProposed(address indexed proposed, uint256 executeAfter);
    event TreasuryCanceled(address indexed canceledProposal);
    event OperatorSet(address indexed operator, bool active);
    event AgentTransferred(string indexed agentId, address indexed oldCreator, address indexed newCreator);

    /// @notice Emitido cuando Chainlink Automation ejecuta performUpkeep
    event UpkeepPerformed(uint256 indexed timestamp, address indexed performer);

    event DailyCapUpdated(uint256 oldCap, uint256 newCap);
    event RegistrationFeeUpdated(uint256 newFee);
    event EarningsClaimed(address indexed creator, uint256 grossAmount, uint256 creatorShare, uint256 platformShare, bytes32 nonce);

    // ── Pre-funded Key Events ────────────────────────────────────────────────
    event KeyFunded(bytes32 indexed keyId, address indexed owner, uint256 amount);
    event KeyCallSettled(bytes32 indexed keyId, string slug, uint256 amount, uint256 creatorShare, uint256 platformShare);
    event KeyRefunded(bytes32 indexed keyId, address indexed owner, uint256 amount);
    /// @notice Emitted when a key owner withdraws USDC directly from their key balance.
    event KeyWithdrawn(bytes32 indexed keyId, address indexed owner, uint256 amount);

    /// @notice Emitted when settleKeyBatch skips a slug not registered in the contract.
    event SettlementSkipped(bytes32 indexed keyId, string slug, uint256 amount);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    function _checkOperator() internal view {
        require(
            operators[msg.sender] || msg.sender == owner(),
            "WasiAI: not operator"
        );
    }

    modifier onlyOperator() { _checkOperator(); _; }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _usdc, address _treasury) Ownable(msg.sender) EIP712("WasiAIMarketplace", "1") {
        require(_usdc     != address(0), "WasiAI: zero USDC");
        require(_treasury != address(0), "WasiAI: zero treasury");
        usdc     = IERC20(_usdc);
        treasury = _treasury;
        operators[msg.sender] = true;
        lastOperatorActivity  = block.timestamp;
        lastUpkeepTimestamp   = block.timestamp;
        dailySettlementCap    = 10_000 * 1e6; // 10,000 USDC default
        dailySettlementReset  = block.timestamp;
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
            erc8004Id:     erc8004Id
        });

        emit AgentRegistered(slug, creator, pricePerCall, erc8004Id);
    }

    /**
     * @notice Set the registration fee for selfRegisterAgent.
     * @dev NA-301: Fee goes to contract treasury. 0 = free registration.
     */
    function setRegistrationFee(uint256 _fee) external onlyOwner {
        registrationFee = _fee;
        emit RegistrationFeeUpdated(_fee);
    }

    /// @notice Set how many free registrations each user gets before fee kicks in.
    function setFreeRegistrationsPerUser(uint256 _count) external onlyOwner {
        freeRegistrationsPerUser = _count;
    }

    /**
     * @notice Self-registration: creator registers their own agent and pays gas.
     * @dev msg.sender becomes the creator. No operator needed.
     *      WAS-160g: Dual Registration — allows creators to register on-chain directly.
     *      NA-301: Registration fee required (if > 0).
     *      NA-303: Slug length <= 80 enforced.
     *      NA-304: pricePerCall range [1000, 100_000_000] enforced.
     */
    function selfRegisterAgent(
        string  calldata slug,
        uint256 pricePerCall,
        uint64  erc8004Id
    ) external whenNotPaused {
        // NA-301b: Charge fee only after free registrations exhausted
        uint256 userCount = userRegistrationCount[msg.sender];
        if (registrationFee > 0 && userCount >= freeRegistrationsPerUser) {
            // NA-R01: use SafeERC20 — reverts on false return value
            usdc.safeTransferFrom(msg.sender, address(this), registrationFee);
        }
        userRegistrationCount[msg.sender] = userCount + 1;

        // NA-303: Slug length validation
        require(bytes(slug).length > 0 && bytes(slug).length <= 80, "Invalid slug length");

        // NA-304: Price range validation
        require(pricePerCall >= 1000 && pricePerCall <= 100_000_000, "Price out of range");

        require(
            agents[slug].creator == address(0),
            "WasiAI: slug taken"
        );

        agents[slug] = Agent({
            creator:       msg.sender,
            pricePerCall:  pricePerCall,
            erc8004Id:     erc8004Id
        });

        emit AgentRegistered(slug, msg.sender, pricePerCall, erc8004Id);
    }

    /**
     * @notice Batch self-registration: creator registers multiple agents in a single tx.
     * @dev msg.sender becomes the creator for all slugs.
     *      WAS-216: batchSelfRegister — up to 50 slugs per call.
     *      Free registrations tier applies across the batch.
     * @param slugs       Agent slug identifiers (unique per slug)
     * @param prices      Price per call for each agent in USDC atomic units (6 decimals)
     * @param erc8004Ids  ERC-8004 identity token IDs (0 = not registered)
     */
    function batchSelfRegister(
        string[]  calldata slugs,
        uint256[] calldata prices,
        uint64[]  calldata erc8004Ids
    ) external whenNotPaused {
        require(slugs.length > 0,                            "WasiAI: empty batch");
        require(slugs.length <= 50,                          "WasiAI: batch too large");
        require(slugs.length == prices.length,               "WasiAI: array length mismatch");
        require(slugs.length == erc8004Ids.length,           "WasiAI: array length mismatch");

        // Pre-check: validate each slug and ensure all are available
        for (uint256 i = 0; i < slugs.length; i++) {
            // Finding #2: slug length validation (mirrors selfRegisterAgent)
            require(
                bytes(slugs[i]).length > 0 && bytes(slugs[i]).length <= 80,
                "WasiAI: invalid slug length"
            );
            // Finding #3: price range validation (mirrors selfRegisterAgent)
            require(
                prices[i] >= 1_000 && prices[i] <= 100_000_000,
                "WasiAI: invalid price"
            );
            require(
                agents[slugs[i]].creator == address(0),
                string(abi.encodePacked("WasiAI: slug taken: ", slugs[i]))
            );
            // Finding #1: detect intra-batch duplicates (O(n²), safe for n<=50)
            for (uint256 j = 0; j < i; j++) {
                require(
                    keccak256(bytes(slugs[i])) != keccak256(bytes(slugs[j])),
                    string(abi.encodePacked("WasiAI: duplicate slug in batch: ", slugs[i]))
                );
            }
        }

        // Fee calculation using ternary to avoid underflow in 0.8.x checked arithmetic
        uint256 userCount      = userRegistrationCount[msg.sender];
        uint256 freeRestantes  = (userCount >= freeRegistrationsPerUser)
            ? 0
            : freeRegistrationsPerUser - userCount;
        uint256 feeCount       = (slugs.length > freeRestantes)
            ? slugs.length - freeRestantes
            : 0;
        uint256 totalFee       = feeCount * registrationFee;

        if (totalFee > 0) {
            usdc.safeTransferFrom(msg.sender, address(this), totalFee);
        }

        userRegistrationCount[msg.sender] += slugs.length;

        for (uint256 i = 0; i < slugs.length; i++) {
            agents[slugs[i]] = Agent({
                creator:      msg.sender,
                pricePerCall: prices[i],
                erc8004Id:    erc8004Ids[i]
            });
            emit AgentRegistered(slugs[i], msg.sender, prices[i], erc8004Ids[i]);
        }
    }

    /**
     * @notice Update agent price.
     * @dev Callable by the creator themselves or by an operator.
     *      WAS-161: active removed — status controlled off-chain in Supabase.
     */
    function updateAgent(
        string  calldata slug,
        uint256 newPrice
    ) external whenNotPaused {
        Agent storage agent = agents[slug];
        require(agent.creator != address(0), "WasiAI: agent not found");
        require(
            agent.creator == msg.sender ||
            operators[msg.sender]       ||
            msg.sender == owner(),
            "WasiAI: not authorized"
        );
        agent.pricePerCall = newPrice;
        emit AgentUpdated(slug, newPrice);
    }

    /// @notice Transfer agent ownership to a new creator.
    /// @param agentId  The agent slug to transfer.
    /// @param newOwner New creator address. Cannot be address(0).
    function transferAgent(string calldata agentId, address newOwner) external nonReentrant {
        require(newOwner != address(0), "WasiAI: zero address");
        Agent storage agent = agents[agentId];
        require(agent.creator != address(0), "WasiAI: agent not found");
        require(agent.creator == msg.sender, "WasiAI: not creator");
        address old = agent.creator;
        agent.creator = newOwner;
        emit AgentTransferred(agentId, old, newOwner);
    }

    // ─── FLOW GUIDE ───────────────────────────────────────────────────────────────
    // This contract implements two payment flows that share state but serve
    // distinct use cases:
    //
    //  ┌─ Flow x402 (direct payment, post-funded) ──────────────────────────────┐
    //  │  Used by: Ultravioleta DAO facilitator after on-chain USDC settlement  │
    //  │  Functions: recordInvocation(), withdraw(), withdrawFor()              │
    //  │  State:     earnings[creator], totalEarnings, usedPaymentIds           │
    //  └────────────────────────────────────────────────────────────────────────┘
    //
    //  ┌─ Flow Key (pre-funded API key) ────────────────────────────────────────┐
    //  │  Used by: Backend operator after user signs ERC-3009 authorization     │
    //  │  Functions: depositForKey(), settleKeyBatch(), refundKeyToEarnings(),  │
    //  │             emergencyWithdrawKey()                                      │
    //  │  State:     keyBalances[keyId], keyOwners[keyId], totalKeyBalances     │
    //  └────────────────────────────────────────────────────────────────────────┘
    //
    //  Both flows share: agents[], operators[], platformFeeBps, totalVolume,
    //  totalInvocations, treasury.
    //
    //  OZ-A1 note: A single `onlyOperator` modifier controls both flows.
    //  Future role separation tracked in WAS-110+.
    // ─────────────────────────────────────────────────────────────────────────────

    // ─── Payment Accounting ───────────────────────────────────────────────────

    /**
     * @notice Record an invocation and split earnings.
     * @dev flow: x402
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
    ) external onlyOperator nonReentrant whenNotPaused {
        // NA-210: whenNotPaused — no registrar invocaciones cuando el contrato está pausado
        lastOperatorActivity = block.timestamp;
        require(!usedPaymentIds[paymentId], "WasiAI: payment already recorded");
        usedPaymentIds[paymentId] = true;

        Agent storage agent = agents[slug];
        // WAS-161: active check removed — status controlled in Supabase (backend filters before contract call)
        require(agent.creator != address(0), "WasiAI: agent not found");
        require(amount > 0,    "WasiAI: zero amount");
        require(amount == agent.pricePerCall, "WasiAI: amount mismatch");

        // Verify contract actually holds the funds
        // (soft check — if the operator is trusted this is just defensive)
        require(
            usdc.balanceOf(address(this)) - totalKeyBalances - totalEarnings >= amount,
            "WasiAI: insufficient balance"
        );

        uint256 platformShare = (amount * platformFeeBps) / 10_000;
        uint256 creatorShare  = amount - platformShare;

        // Accumulate creator earnings (pull pattern — creator withdraws when ready)
        earnings[agent.creator] += creatorShare;
        totalEarnings           += creatorShare;
        // Note: platformShare goes to treasury immediately -- not tracked in totalEarnings

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
     * @dev flow: x402 (also accessible after Key refund via refundKeyToEarnings)
     */
    function withdraw() external nonReentrant {
        uint256 amount = earnings[msg.sender];
        require(amount > 0, "WasiAI: nothing to withdraw");

        earnings[msg.sender] = 0;
        totalEarnings       -= amount;
        usdc.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Operator-triggered withdrawal on behalf of a creator.
     * @dev flow: x402
     * @dev Useful for automatic payouts triggered by the backend.
     */
    function withdrawFor(address creator) external onlyOperator nonReentrant {
        lastOperatorActivity = block.timestamp;
        uint256 amount = earnings[creator];
        require(amount > 0, "WasiAI: nothing to withdraw");

        earnings[creator] = 0;
        totalEarnings    -= amount;
        usdc.safeTransfer(creator, amount);

        emit Withdrawn(creator, amount);
    }

    /**
     * @notice Creator claims earnings via a signed voucher (EIP-712).
     * @dev Voucher is signed by a backend operator. Deducts 10% to treasury, 90% to creator.
     * @param grossAmount  Total USDC in atomic units to claim.
     * @param deadline     Unix timestamp — voucher expires after this.
     * @param nonce        Random bytes32 — prevents replay.
     * @param sig          EIP-712 operator signature.
     */
    /**
     * @notice Withdraw earnings for a creator via an operator-signed EIP-712 voucher.
     * @param creator       The registered creator wallet — USDC is sent here regardless of msg.sender.
     * @param grossAmount   Gross USDC amount (atomics). Contract deducts platform fee on-chain.
     * @param deadline      Unix timestamp after which the voucher is invalid.
     * @param nonce         Unique bytes32 anti-replay identifier.
     * @param sig           EIP-712 signature from an operator over (creator, grossAmount, deadline, nonce).
     */
    function claimEarnings(
        address creator,
        uint256 grossAmount,
        uint256 deadline,
        bytes32 nonce,
        bytes calldata sig
    ) external nonReentrant whenNotPaused {
        require(creator != address(0),             "WasiAI: zero creator");
        require(msg.sender == creator,             "WasiAI: caller must be creator"); // NA-V01
        // 1. Expiry guard
        require(block.timestamp <= deadline,       "WasiAI: voucher expired");

        // 2. Anti-replay
        require(!usedVouchers[nonce],              "WasiAI: voucher already used");
        usedVouchers[nonce] = true;

        // 3. Verify EIP-712 signature — signed for explicit creator address
        bytes32 structHash = keccak256(abi.encode(
            CLAIM_TYPEHASH,
            creator,
            grossAmount,
            deadline,
            nonce
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, sig);
        require(operators[signer], "WasiAI: invalid operator signature");

        // 4. Balance guard — protect Agent Key balances
        require(
            usdc.balanceOf(address(this)) - totalKeyBalances - totalEarnings >= grossAmount,
            "WasiAI: insufficient free balance"
        );

        // 5. Split: 90% to creator wallet, 10% to treasury
        uint256 platformShare = (grossAmount * platformFeeBps) / 10_000;
        uint256 creatorShare  = grossAmount - platformShare;

        // 6. Transfers — USDC always goes to registered creator wallet, not msg.sender
        usdc.safeTransfer(creator, creatorShare);
        if (platformShare > 0) {
            usdc.safeTransfer(treasury, platformShare);
        }

        emit EarningsClaimed(creator, grossAmount, creatorShare, platformShare, nonce);
    }

    // ─── Pre-funded API Key Flows ─────────────────────────────────────────────

    /**
     * @notice Fund an API key with USDC via ERC-3009 transferWithAuthorization.
     * @dev flow: Key
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

        // NA-205: si la key ya tiene owner, solo ese owner puede depositar más
        if (keyOwners[keyId] != address(0)) {
            require(owner == keyOwners[keyId], "WasiAI: not key owner");
        }

        keyBalances[keyId]  += amount;
        totalKeyBalances    += amount;
        if (keyOwners[keyId] == address(0)) {
            keyOwners[keyId] = owner;
        }

        emit KeyFunded(keyId, owner, amount);
    }

    /// @dev Reset daily counter if 24h window has passed.
    function _checkAndResetDailyWindow() internal {
        if (block.timestamp >= dailySettlementReset + 24 hours) {
            dailySettledAmount   = 0;
            dailySettlementReset = block.timestamp;
        }
    }

    /**
     * @notice Liquida un batch de llamadas de key en una sola tx, skipping slugs no registrados.
     * @dev flow: Key
     * @dev Gas amortizado: una tx cubre cientos de llamadas (~5,000 gas/item, max seguro ~300 slugs ≈ 1.5M gas
     *      de un bloque de 15M). El loop NO contiene external calls (solo storage writes).
     *      El único transfer USDC ocurre post-loop: `safeTransfer(treasury, totalPlatformShare)`.
     *      WAS-216: graceful — slugs no registrados se skipean emitiendo SettlementSkipped.
     *      La deducción de keyBalance ocurre post-loop sobre totalSettled (solo slugs registrados).
     *      reentrancy safety: garantizado por nonReentrant; no hay external calls durante el loop.
     * @param keyId   bytes32 derived from SHA-256 of the raw API key
     * @param slugs   Agent slug identifiers (1-1 with amounts)
     * @param amounts USDC amounts in atomic units per slug
     */
    function settleKeyBatch(
        bytes32           keyId,
        string[]  calldata slugs,
        uint256[] calldata amounts
    ) external onlyOperator nonReentrant whenNotPaused {
        lastOperatorActivity = block.timestamp;
        require(slugs.length == amounts.length, "WasiAI: length mismatch");
        require(slugs.length > 0,               "WasiAI: empty batch");
        require(slugs.length <= 500,            "WasiAI: batch too large");

        uint256 totalSettled       = 0;
        uint256 totalPlatformShare = 0;

        for (uint256 i = 0; i < slugs.length; i++) {
            // WAS-216: graceful — skip unregistered slugs, emit event
            if (agents[slugs[i]].creator == address(0)) {
                emit SettlementSkipped(keyId, slugs[i], amounts[i]);
                continue;
            }

            require(amounts[i] > 0, "WasiAI: zero amount");

            uint256 platformShare = (amounts[i] * platformFeeBps) / 10_000;
            uint256 creatorShare  = amounts[i] - platformShare;

            earnings[agents[slugs[i]].creator] += creatorShare;
            totalEarnings                      += creatorShare;
            totalPlatformShare                 += platformShare;
            totalSettled                       += amounts[i];

            totalVolume      += amounts[i];
            totalInvocations += 1;

            emit KeyCallSettled(keyId, slugs[i], amounts[i], creatorShare, platformShare);
        }

        // Daily cap check post-loop (total real settled, not pre-loop estimate)
        _checkAndResetDailyWindow();
        if (dailySettlementCap > 0) {
            require(
                dailySettledAmount + totalSettled <= dailySettlementCap,
                "WasiAI: daily cap exceeded"
            );
        }
        dailySettledAmount += totalSettled;

        // Deduct key balance post-loop (only registered slugs' amounts)
        require(keyBalances[keyId] >= totalSettled, "WasiAI: insufficient key balance");
        keyBalances[keyId]  -= totalSettled;
        totalKeyBalances    -= totalSettled;

        // Single transfer to treasury after loop — avoids gas blowup in large batches
        if (totalPlatformShare > 0) {
            usdc.safeTransfer(treasury, totalPlatformShare);
        }
    }

    /**
     * @notice Mueve el balance restante de una key a earnings del owner.
     * @dev flow: Key
     * @dev Operador llama esto cuando el usuario cierra su key.
     *      El owner luego usa withdraw() como cualquier creator.
     */
    function refundKeyToEarnings(bytes32 keyId) external onlyOperator nonReentrant whenNotPaused {
        lastOperatorActivity = block.timestamp;
        require(keyOwners[keyId] != address(0), "WasiAI: unknown key");
        uint256 amount = keyBalances[keyId];
        require(amount > 0, "WasiAI: nothing to refund");

        keyBalances[keyId]          = 0;
        totalKeyBalances           -= amount;
        earnings[keyOwners[keyId]] += amount;
        totalEarnings              += amount;

        emit KeyRefunded(keyId, keyOwners[keyId], amount);
    }

    /**
     * @notice Salida de emergencia: usuario recupera su USDC si el operador
     *         lleva más de EMERGENCY_TIMEOUT sin actividad.
     * @dev flow: Key (trustless exit — no operator permission required)
     * @dev Trustless exit — no requiere permiso del operador.
     */
    /**
     * @notice Creator withdraws USDC directly from their key balance.
     * @dev    Partial or full withdrawal — key stays active unless fully drained.
     *         No whenNotPaused: users must always be able to recover their funds.
     * @param keyId  bytes32 key identifier (SHA-256 of raw key, padded)
     * @param amount USDC amount in atomic units (6 decimals)
     */
    function withdrawKey(bytes32 keyId, uint256 amount) external nonReentrant {
        require(keyOwners[keyId] == msg.sender,    "WasiAI: not key owner");
        require(amount > 0,                         "WasiAI: amount must be > 0");
        require(keyBalances[keyId] >= amount,       "WasiAI: insufficient key balance");

        keyBalances[keyId] -= amount;
        totalKeyBalances   -= amount;
        usdc.safeTransfer(msg.sender, amount);

        emit KeyWithdrawn(keyId, msg.sender, amount);
    }

    function emergencyWithdrawKey(bytes32 keyId) external nonReentrant {
        require(
            block.timestamp > lastOperatorActivity + EMERGENCY_TIMEOUT,
            "WasiAI: operator still active"
        );
        require(keyOwners[keyId] == msg.sender, "WasiAI: not key owner");

        uint256 amount = keyBalances[keyId];
        require(amount > 0, "WasiAI: nothing to withdraw");

        keyBalances[keyId] = 0;
        totalKeyBalances  -= amount;
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

    // ── Daily Cap Admin (WAS-94) ──────────────────────────────────────────────

    /// @notice Update the daily settlement cap.
    /// @dev NA-212: Cap no puede ser 0 (deja el sistema sin límite) ni exceder 100k USDC.
    function setDailySettlementCap(uint256 newCap) external onlyOwner {
        require(newCap >= 100 * 1e6,          "WasiAI: cap too low");   // mínimo 100 USDC
        require(newCap <= 100_000 * 1e6,      "WasiAI: cap too high");  // máximo 100k USDC
        uint256 old = dailySettlementCap;
        dailySettlementCap = newCap;
        emit DailyCapUpdated(old, newCap);
    }

    /// @notice Returns current daily settlement window status.
    function getDailySettlementStatus()
        external view
        returns (uint256 cap, uint256 settled, uint256 resetsAt)
    {
        cap      = dailySettlementCap;
        settled  = dailySettledAmount;
        resetsAt = dailySettlementReset + 24 hours;
    }

    // ── Fee Timelock (NA-M03 fix) ─────────────────────────────────────────────

    /// @notice Step 1: propose a new platform fee. Executable after 48h.
    function proposeFee(uint16 bps) external onlyOwner {
        require(bps <= 3000, "WasiAI: max 30%");
        pendingFeeBps = bps;
        pendingFeeTimestamp = block.timestamp + FEE_TIMELOCK;
        emit FeeProposed(bps, pendingFeeTimestamp);
    }

    /// @notice Step 2: execute the proposed fee after timelock expires.
    function executeFee() external onlyOwner {
        require(pendingFeeTimestamp > 0,                "WasiAI: no pending fee");
        require(block.timestamp >= pendingFeeTimestamp, "WasiAI: timelock active");
        uint16 oldBps = platformFeeBps;
        platformFeeBps = pendingFeeBps;
        pendingFeeBps = 0;
        pendingFeeTimestamp = 0;
        emit PlatformFeeUpdated(oldBps, platformFeeBps);
    }

    /// @notice Cancel a pending fee proposal.
    function cancelFee() external onlyOwner {
        require(pendingFeeTimestamp > 0, "WasiAI: no pending fee");
        emit FeeCanceled(pendingFeeBps);
        pendingFeeBps = 0;
        pendingFeeTimestamp = 0;
    }

    /// @notice Pause deposits and batch settlement. Emergency use only.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the contract.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice NA-202: Propose treasury address change (48h timelock).
    function proposeTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "WasiAI: zero address");
        require(_treasury != treasury,   "WasiAI: same treasury");
        pendingTreasury          = _treasury;
        pendingTreasuryTimestamp = block.timestamp + TREASURY_TIMELOCK;
        emit TreasuryProposed(_treasury, pendingTreasuryTimestamp);
    }

    /// @notice NA-202: Execute treasury change after timelock expires.
    function executeTreasury() external onlyOwner {
        require(pendingTreasury != address(0),            "WasiAI: no pending treasury");
        require(block.timestamp >= pendingTreasuryTimestamp, "WasiAI: timelock active");
        address oldTreasury = treasury;
        treasury = pendingTreasury;
        pendingTreasury          = address(0);
        pendingTreasuryTimestamp = 0;
        emit TreasuryUpdated(oldTreasury, treasury);
    }

    /// @notice NA-202: Cancel pending treasury proposal.
    function cancelTreasury() external onlyOwner {
        require(pendingTreasury != address(0), "WasiAI: no pending treasury");
        address canceled = pendingTreasury;
        pendingTreasury          = address(0);
        pendingTreasuryTimestamp = 0;
        emit TreasuryCanceled(canceled);
    }

    /**
     * @notice Emergency withdraw of USDC not covered by key balances or earnings.
     * @dev    WAS-216 AC-20: Only callable by owner when paused. Allows recovery of
     *         excess USDC (e.g., accidental deposits) without touching user funds.
     *         Invariant: only transfers USDC above (totalKeyBalances + totalEarnings).
     * @param to  Recipient address for the excess USDC
     */
    function emergencyWithdrawUSDC(address to) external onlyOwner whenPaused {
        require(to != address(0), "WasiAI: zero address");
        uint256 balance     = usdc.balanceOf(address(this));
        uint256 obligated   = totalKeyBalances + totalEarnings;
        require(balance > obligated, "WasiAI: no excess USDC");
        uint256 excess = balance - obligated;
        usdc.safeTransfer(to, excess);
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

    /// @notice Check contract solvency.
    /// @return solvent         true if contract holds enough USDC for all obligations
    /// @return totalAccounted  sum of all keyBalances + all earnings
    /// @return contractBalance current USDC balance of this contract
    function checkSolvency()
        external view
        returns (bool solvent, uint256 totalAccounted, uint256 contractBalance)
    {
        totalAccounted  = totalKeyBalances + totalEarnings;
        contractBalance = usdc.balanceOf(address(this));
        solvent         = contractBalance >= totalAccounted;
    }

    // ─── Chainlink Automation ─────────────────────────────────────────────────

    /// @notice Chainlink Automation compatible — checkUpkeep
    /// @dev Retorna true si han pasado >= UPKEEP_INTERVAL desde el último upkeep.
    ///      No requiere checkData — se ignora.
    function checkUpkeep(bytes calldata /* checkData */)
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory /* performData */)
    {
        upkeepNeeded = (block.timestamp - lastUpkeepTimestamp) >= UPKEEP_INTERVAL;
    }

    /// @notice Chainlink Automation compatible — performUpkeep
    /// @dev Emite UpkeepPerformed y actualiza lastUpkeepTimestamp.
    ///      El settlement real sigue ejecutándose desde el operador backend.
    ///      Cualquier address puede llamar performUpkeep — el intervalo protege
    ///      de abuso (solo ejecutable cada 23h máximo).
    function performUpkeep(bytes calldata /* performData */) external override onlyOperator {
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

    // ─── ERC-8004 Reputation Registry ─────────────────────────────────────────

    struct ReputationRecord {
        uint16  avgRating;     // scaled ×100 (e.g. 450 = 4.50 stars, max 500)
        uint32  totalCalls;    // WAS-216: total invocations in reporting period
        uint32  successCalls;  // WAS-216: successful invocations
        uint32  disputeCount;  // WAS-216: number of disputes raised
        uint32  avgResponseMs; // WAS-216: average response time in milliseconds
        uint64  lastUpdated;   // block.timestamp of last batch
    }

    /// slug → on-chain reputation
    mapping(string => ReputationRecord) public reputations;

    event ReputationBatchSubmitted(
        uint256 indexed batchSize,
        uint256 indexed timestamp
    );

    /**
     * @notice Submit aggregated reputation scores for a batch of agents (V2: 6 fields).
     * @dev    Called daily by cron operator. Overwrites previous values.
     *         WAS-216: extended with totalCalls, successCalls, disputeCount, avgResponseMs.
     *         avgRatings scaled ×100 (uint16): 0–500 (0.00–5.00 stars).
     * @param slugs          Agent slug identifiers
     * @param avgRatings     Average rating per agent (uint16, ×100 scaled)
     * @param totalCalls     Total invocations per agent in reporting period
     * @param successCalls   Successful invocations per agent
     * @param disputeCounts  Dispute count per agent
     * @param avgResponseMs  Average response time per agent in milliseconds
     */
    function submitReputationBatch(
        string[] calldata slugs,
        uint16[] calldata avgRatings,
        uint32[] calldata totalCalls,
        uint32[] calldata successCalls,
        uint32[] calldata disputeCounts,
        uint32[] calldata avgResponseMs
    ) external onlyOperator whenNotPaused {
        lastOperatorActivity = block.timestamp;
        uint256 len = slugs.length;
        require(len > 0,                      "WasiAI: empty batch");
        require(len <= 500,                   "WasiAI: batch too large");
        require(len == avgRatings.length,     "WasiAI: length mismatch");
        require(len == totalCalls.length,     "WasiAI: length mismatch");
        require(len == successCalls.length,   "WasiAI: length mismatch");
        require(len == disputeCounts.length,  "WasiAI: length mismatch");
        require(len == avgResponseMs.length,  "WasiAI: length mismatch");

        for (uint256 i = 0; i < len; i++) {
            require(avgRatings[i] <= 500,     "WasiAI: rating out of range");
            require(
                agents[slugs[i]].creator != address(0),
                "WasiAI: agent not found"
            );

            reputations[slugs[i]] = ReputationRecord({
                avgRating:     avgRatings[i],
                totalCalls:    totalCalls[i],
                successCalls:  successCalls[i],
                disputeCount:  disputeCounts[i],
                avgResponseMs: avgResponseMs[i],
                lastUpdated:   uint64(block.timestamp)
            });
        }

        emit ReputationBatchSubmitted(len, block.timestamp);
    }

    /**
     * @notice Read on-chain reputation for an agent (V2: 6 fields).
     * @return avgRating     Average rating scaled ×100 (0–500)
     * @return totalCalls    Total invocations in reporting period
     * @return successCalls  Successful invocations
     * @return disputeCount  Number of disputes
     * @return avgResponseMs Average response time in milliseconds
     * @return lastUpdated   Timestamp of last reputation update
     */
    function getReputation(string calldata slug)
        external view
        returns (
            uint16 avgRating,
            uint32 totalCalls,
            uint32 successCalls,
            uint32 disputeCount,
            uint32 avgResponseMs,
            uint64 lastUpdated
        )
    {
        ReputationRecord memory r = reputations[slug];
        return (r.avgRating, r.totalCalls, r.successCalls, r.disputeCount, r.avgResponseMs, r.lastUpdated);
    }

    /// @notice Compute the canonical paymentId for an invocation.
    /// @dev    Off-chain verifiable: anyone can recompute with public data.
    ///         paymentId = keccak256(slug, payer, amount, nonce, chainId)
    function computePaymentId(
        string  calldata slug,
        address          payer,
        uint256          amount,
        bytes32          nonce
    ) external view returns (bytes32) {
        // NA-209: abi.encode evita colisiones de hash (pad a 32 bytes, sin ambigüedad)
        return keccak256(abi.encode(slug, payer, amount, nonce, block.chainid));
    }
}
