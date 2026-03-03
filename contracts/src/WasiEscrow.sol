// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC3009 {
    function transferWithAuthorization(
        address from, address to, uint256 value,
        uint256 validAfter, uint256 validBefore,
        bytes32 nonce, uint8 v, bytes32 r, bytes32 s
    ) external;
}

/**
 * @title  WasiEscrow
 * @notice Escrow USDC para agentes de tareas largas (WAS-72).
 * @dev    Deploy SOLO en Fuji (chainId: 43113).
 *         Flujo: createEscrow → (agente completa) → releaseEscrow
 *                                                  → refundEscrow (si falla)
 *                Si operador inactivo 24h → releaseExpired (trustless)
 */
contract WasiEscrow is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Types ────────────────────────────────────────────────────────────────

    enum EscrowStatus { Pending, Released, Refunded, Disputed }

    struct EscrowTx {
        address payer;
        string  slug;
        uint256 amount;
        uint256 createdAt;
        EscrowStatus status;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20  public immutable usdc;
    address public immutable marketplace; // WasiAIMarketplace — destino del release

    mapping(bytes32 => EscrowTx)  public escrows;
    mapping(address => bool)      public operators;

    uint256 public constant RELEASE_TIMEOUT = 24 hours;

    // ─── Events ───────────────────────────────────────────────────────────────

    event EscrowCreated(bytes32 indexed escrowId, string slug, address indexed payer, uint256 amount);
    event EscrowReleased(bytes32 indexed escrowId, address indexed to, uint256 amount);
    event EscrowRefunded(bytes32 indexed escrowId, address indexed payer, uint256 amount);
    event EscrowDisputed(bytes32 indexed escrowId);
    event OperatorSet(address indexed operator, bool active);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOperator() {
        require(operators[msg.sender] || msg.sender == owner(), "WasiEscrow: not operator");
        _;
    }

    modifier escrowExists(bytes32 escrowId) {
        require(escrows[escrowId].createdAt > 0, "WasiEscrow: not found");
        _;
    }

    modifier isPending(bytes32 escrowId) {
        require(escrows[escrowId].status == EscrowStatus.Pending, "WasiEscrow: not pending");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _usdc, address _marketplace) Ownable(msg.sender) {
        require(_usdc        != address(0), "WasiEscrow: zero usdc");
        require(_marketplace != address(0), "WasiEscrow: zero marketplace");
        usdc        = IERC20(_usdc);
        marketplace = _marketplace;
        operators[msg.sender] = true;
    }

    // ─── Core ─────────────────────────────────────────────────────────────────

    /**
     * @notice Crea un escrow moviendo USDC del payer al contrato via ERC-3009.
     * @param escrowId  keccak256(slug, payer, amount, nonce, chainId) — generado off-chain
     * @param slug      Agente slug
     * @param payer     Wallet del usuario que paga
     * @param amount    USDC en atomic units (6 decimals)
     */
    function createEscrow(
        bytes32 escrowId,
        string  calldata slug,
        address payer,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8   v,
        bytes32 r,
        bytes32 s
    ) external onlyOperator nonReentrant {
        require(escrowId != bytes32(0),               "WasiEscrow: zero escrowId");
        require(bytes(slug).length > 0,               "WasiEscrow: empty slug");
        require(payer != address(0),                  "WasiEscrow: zero payer");
        require(amount > 0,                           "WasiEscrow: zero amount");
        require(escrows[escrowId].createdAt == 0,     "WasiEscrow: escrowId exists");

        IERC3009(address(usdc)).transferWithAuthorization(
            payer, address(this), amount,
            validAfter, validBefore, nonce, v, r, s
        );

        escrows[escrowId] = EscrowTx({
            payer:     payer,
            slug:      slug,
            amount:    amount,
            createdAt: block.timestamp,
            status:    EscrowStatus.Pending
        });

        emit EscrowCreated(escrowId, slug, payer, amount);
    }

    /**
     * @notice Operador libera el escrow al Marketplace (agente completó).
     *         Backend luego llama WasiAIMarketplace.recordInvocation().
     */
    function releaseEscrow(bytes32 escrowId)
        external
        onlyOperator
        nonReentrant
        escrowExists(escrowId)
        isPending(escrowId)
    {
        _release(escrowId);
    }

    /**
     * @notice Trustless release: cualquiera puede llamar tras RELEASE_TIMEOUT.
     *         Protege al payer si el operador desaparece.
     */
    function releaseExpired(bytes32 escrowId)
        external
        nonReentrant
        escrowExists(escrowId)
        isPending(escrowId)
    {
        require(
            block.timestamp >= escrows[escrowId].createdAt + RELEASE_TIMEOUT,
            "WasiEscrow: timeout not reached"
        );
        _release(escrowId);
    }

    /**
     * @notice Operador devuelve USDC al payer (agente falló o cancelación).
     */
    function refundEscrow(bytes32 escrowId)
        external
        onlyOperator
        nonReentrant
        escrowExists(escrowId)
        isPending(escrowId)
    {
        EscrowTx storage e = escrows[escrowId];
        e.status = EscrowStatus.Refunded;
        usdc.safeTransfer(e.payer, e.amount);
        emit EscrowRefunded(escrowId, e.payer, e.amount);
    }

    /**
     * @notice Marca como Disputed. Resolución manual off-chain.
     */
    function disputeEscrow(bytes32 escrowId)
        external
        onlyOperator
        escrowExists(escrowId)
        isPending(escrowId)
    {
        escrows[escrowId].status = EscrowStatus.Disputed;
        emit EscrowDisputed(escrowId);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _release(bytes32 escrowId) internal {
        EscrowTx storage e = escrows[escrowId];
        e.status = EscrowStatus.Released;
        usdc.safeTransfer(marketplace, e.amount);
        emit EscrowReleased(escrowId, marketplace, e.amount);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setOperator(address operator, bool active) external onlyOwner {
        require(operator != address(0), "WasiEscrow: zero address");
        operators[operator] = active;
        emit OperatorSet(operator, active);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getEscrow(bytes32 escrowId) external view returns (EscrowTx memory) {
        return escrows[escrowId];
    }

    /**
     * @notice Computa el escrowId canónico off-chain.
     */
    function computeEscrowId(
        string  calldata slug,
        address payer,
        uint256 amount,
        bytes32 nonce
    ) external view returns (bytes32) {
        return keccak256(abi.encodePacked(slug, payer, amount, nonce, block.chainid));
    }
}
