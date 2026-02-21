// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

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
 * Fee model:
 *   - Default: 10% to WasiAI treasury, 90% to agent creator
 *   - Adjustable by owner (max 30%)
 *   - Early creator program: set fee to 0% for specific creators
 *
 * @dev Deployed on Avalanche C-Chain (chainId: 43114)
 *      USDC: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
 */
contract WasiAIMarketplace is Ownable, ReentrancyGuard {
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
    event OperatorSet(address indexed operator, bool active);

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
        uint256          amount
    ) external onlyOperator nonReentrant {
        Agent storage agent = agents[slug];
        require(agent.active,  "WasiAI: agent inactive");
        require(amount > 0,    "WasiAI: zero amount");

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
        uint256 amount = earnings[creator];
        require(amount > 0, "WasiAI: nothing to withdraw");

        earnings[creator] = 0;
        usdc.safeTransfer(creator, amount);

        emit Withdrawn(creator, amount);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setPlatformFee(uint16 bps) external onlyOwner {
        require(bps <= 3000, "WasiAI: max 30%");
        emit PlatformFeeUpdated(platformFeeBps, bps);
        platformFeeBps = bps;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "WasiAI: zero treasury");
        treasury = _treasury;
    }

    function setOperator(address operator, bool active) external onlyOwner {
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

    /// @notice Returns platform stats
    function getStats()
        external view returns (uint256 volume, uint256 invocations, uint16 feeBps)
    {
        return (totalVolume, totalInvocations, platformFeeBps);
    }
}
