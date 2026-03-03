# Story File — WAS-72: Escrow para Tareas Largas
**NNN:** 027 | **Modo:** QUALITY | **Estado:** HU_APPROVED ✅  
**Network:** Fuji testnet (chainId: 43113) — NO mainnet  
**Fecha:** 2026-03-02

> Este documento es autocontenido. Dev no necesita leer otros docs.

---

## Contexto de Negocio

Algunos agentes (transcripción larga, análisis de documentos, pipelines complejos) tardan más de los 30s del timeout del invoke route. Actualmente, si el agente tarda más, la conexión se cae y el usuario pierde el pago.

WAS-72 implementa un flujo de escrow on-chain:
1. Usuario paga → USDC va al contrato `WasiEscrow` (retenido)
2. Agente procesa asíncronamente (segundos a horas)
3. Al completar → operador libera USDC al Marketplace → split creador/plataforma
4. Si falla o el usuario cancela → refund al payer
5. Si el operador no responde en 24h → cualquiera puede disparar `releaseExpired` (trustless)

---

## Decisiones de Arquitectura (NO cambiar sin SPEC_APPROVED)

1. **Contrato separado `WasiEscrow`** — NO extensión de WasiAIMarketplace. Storage aislado, menor superficie de ataque, tests independientes.
2. **Auto-release 24h via endpoint protegido** — `POST /api/v1/internal/escrow/release-expired` con `INTERNAL_API_SECRET`. No Chainlink (no disponible en Fuji). No nuevo Vercel Cron (plan Hobby lleno). El contrato también expone `releaseExpired()` trustless como fallback.
3. **Campo `long_running BOOLEAN` en tabla `agents`** — Creator lo activa al publicar. No parámetro en invoke.

---

## Wave 0 — Contrato + Tests Forge

### Archivo: `contracts/src/WasiEscrow.sol`

```solidity
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
```

### Archivo: `contracts/test/WasiEscrow.t.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/WasiEscrow.sol";

/// @dev Reusar MockUSDC del Marketplace test (misma interfaz ERC-3009 sin sig)
contract MockUSDCReal {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount);
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
    WasiEscrow   escrow;
    MockUSDCReal usdc;

    address owner      = address(0x1);
    address marketplace = address(0x2);
    address payer      = address(0x3);
    address operator   = address(0x4);
    address stranger   = address(0x5);

    string  constant SLUG   = "long-agent";
    uint256 constant AMOUNT = 1_000_000; // 1 USDC

    bytes32 escrowId;

    function setUp() public {
        vm.startPrank(owner);
        usdc   = new MockUSDCReal();
        escrow = new WasiEscrow(address(usdc), marketplace);
        escrow.setOperator(operator, true);
        vm.stopPrank();

        usdc.mint(payer, AMOUNT * 10);
        escrowId = keccak256(abi.encodePacked(SLUG, payer, AMOUNT, bytes32(0), block.chainid));
    }

    function _createEscrow() internal {
        vm.prank(operator);
        escrow.createEscrow(escrowId, SLUG, payer, AMOUNT, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));
    }

    // ── Tests ─────────────────────────────────────────────────────────────────

    function test_CreateEscrow() public {
        _createEscrow();
        WasiEscrow.EscrowTx memory e = escrow.getEscrow(escrowId);
        assertEq(e.payer, payer);
        assertEq(e.amount, AMOUNT);
        assertEq(uint(e.status), uint(WasiEscrow.EscrowStatus.Pending));
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
    }

    function test_CreateEscrow_DuplicateReverts() public {
        _createEscrow();
        vm.prank(operator);
        vm.expectRevert("WasiEscrow: escrowId exists");
        escrow.createEscrow(escrowId, SLUG, payer, AMOUNT, 0, type(uint256).max, bytes32(0), 0, bytes32(0), bytes32(0));
    }

    function test_ReleaseEscrow() public {
        _createEscrow();
        vm.prank(operator);
        escrow.releaseEscrow(escrowId);
        assertEq(usdc.balanceOf(marketplace), AMOUNT);
        assertEq(uint(escrow.getEscrow(escrowId).status), uint(WasiEscrow.EscrowStatus.Released));
    }

    function test_ReleaseExpired_BeforeTimeout_Reverts() public {
        _createEscrow();
        vm.expectRevert("WasiEscrow: timeout not reached");
        escrow.releaseExpired(escrowId);
    }

    function test_ReleaseExpired_AfterTimeout() public {
        _createEscrow();
        vm.warp(block.timestamp + 24 hours + 1);
        escrow.releaseExpired(escrowId);
        assertEq(usdc.balanceOf(marketplace), AMOUNT);
    }

    function test_RefundEscrow() public {
        _createEscrow();
        uint256 before = usdc.balanceOf(payer);
        vm.prank(operator);
        escrow.refundEscrow(escrowId);
        assertEq(usdc.balanceOf(payer), before + AMOUNT);
        assertEq(uint(escrow.getEscrow(escrowId).status), uint(WasiEscrow.EscrowStatus.Refunded));
    }

    function test_DisputeEscrow() public {
        _createEscrow();
        vm.prank(operator);
        escrow.disputeEscrow(escrowId);
        assertEq(uint(escrow.getEscrow(escrowId).status), uint(WasiEscrow.EscrowStatus.Disputed));
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
}
```

**Comando para correr tests:**
```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2/contracts
forge test --match-contract WasiEscrowTest -vvv
```

---

## Wave 1 — Backend Endpoints

### 1a. `src/app/api/v1/agents/[slug]/invoke-long/route.ts`

**Request:**
```typescript
interface InvokeLongRequest {
  // ERC-3009 authorization firmada por el payer
  erc3009: {
    from: string        // payer address
    to: string          // WasiEscrow contract address
    value: string       // USDC amount en atomic units (string para BigInt safe)
    validAfter: number
    validBefore: number
    nonce: string       // bytes32 hex
    v: number
    r: string
    s: string
  }
  // Payload del agente (forwarded asíncronamente)
  agentInput: Record<string, unknown>
}
```

**Response:**
```typescript
interface InvokeLongResponse {
  escrow_id: string           // bytes32 hex
  status: 'pending'
  estimated_completion: string // ISO 8601, now + 24h
  poll_url: string            // /api/v1/escrow/{escrow_id}/status
}
```

**Lógica:**
1. Verificar `agents.long_running = true` y `agents.status = 'active'`
2. Verificar API key del caller (mismo flujo que invoke normal)
3. Calcular `escrowId = keccak256(slug, payer, amount, nonce, chainId)`
4. Llamar `WasiEscrow.createEscrow(...)` via ethers.js (operador wallet desde env)
5. Insertar en `escrow_transactions` con `status = 'pending'`
6. Despachar job asíncrono (fetch al runner del agente sin await)
7. Return 202 con escrow_id

**Env vars necesarias:**
```
OPERATOR_PRIVATE_KEY=0x...
WASI_ESCROW_ADDRESS=0x...   # deploy en Fuji
NEXT_PUBLIC_USDC_ADDRESS=0x...  # Fuji USDC mock
```

### 1b. `src/app/api/v1/escrow/[escrowId]/status/route.ts`

**Response:**
```typescript
interface EscrowStatusResponse {
  escrow_id: string
  status: 'pending' | 'released' | 'refunded' | 'disputed'
  amount_usdc: string
  agent_slug: string
  created_at: string
  released_at: string | null
  result_data: Record<string, unknown> | null
}
```

**Lógica:** SELECT de `escrow_transactions` donde `escrow_id = param` y `payer_user_id = auth.uid()`.

### 1c. `src/app/api/v1/internal/escrow/release-expired/route.ts`

**Auth:** Header `Authorization: Bearer ${process.env.INTERNAL_API_SECRET}`

**Lógica:**
1. Query escrows con `status = 'pending'` y `created_at < now() - interval '24 hours'`
2. Para cada uno:
   - Llamar `WasiEscrow.releaseExpired(escrowId)` on-chain
   - Llamar `WasiAIMarketplace.recordInvocation(slug, payer, amount, paymentId)`
   - UPDATE `escrow_transactions SET status='released', released_at=now(), tx_release=txHash`
3. Return `{ released: n, errors: [] }`

### 1d. `src/lib/contracts/escrow.ts`

```typescript
import { ethers } from 'ethers'

const ESCROW_ABI = [
  'function createEscrow(bytes32,string,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32) external',
  'function releaseEscrow(bytes32) external',
  'function releaseExpired(bytes32) external',
  'function refundEscrow(bytes32) external',
  'function computeEscrowId(string,address,uint256,bytes32) external view returns (bytes32)',
  'function getEscrow(bytes32) external view returns (address,string,uint256,uint256,uint8)',
]

export function getEscrowContract(signerOrProvider: ethers.Signer | ethers.Provider) {
  const address = process.env.WASI_ESCROW_ADDRESS!
  return new ethers.Contract(address, ESCROW_ABI, signerOrProvider)
}

export function getOperatorSigner() {
  const provider = new ethers.JsonRpcProvider(
    process.env.FUJI_RPC_URL ?? 'https://api.avax-test.network/ext/bc/C/rpc'
  )
  return new ethers.Wallet(process.env.OPERATOR_PRIVATE_KEY!, provider)
}
```

---

## Wave 2 — Migración SQL

### Archivo: `supabase/migrations/034_escrow.sql`

```sql
-- 034_escrow.sql
-- WAS-72: Escrow para tareas largas
-- Agrega long_running a agents y crea escrow_transactions

-- ─── Campo long_running en agents ────────────────────────────────────────────
ALTER TABLE agents ADD COLUMN IF NOT EXISTS long_running BOOLEAN NOT NULL DEFAULT false;

-- ─── Tabla escrow_transactions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS escrow_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id       TEXT NOT NULL UNIQUE,    -- bytes32 hex (0x...)
  agent_slug      TEXT NOT NULL,
  payer_address   TEXT NOT NULL,           -- wallet address hex
  payer_user_id   UUID REFERENCES auth.users(id),
  amount_usdc     NUMERIC(20,6) NOT NULL,  -- en USDC humano (e.g. 1.000000)
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','released','refunded','disputed')),
  result_data     JSONB,                   -- payload del agente cuando completa
  tx_create       TEXT,                    -- txHash de createEscrow
  tx_release      TEXT,                    -- txHash de releaseEscrow/releaseExpired
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at     TIMESTAMPTZ,
  refunded_at     TIMESTAMPTZ
);

ALTER TABLE escrow_transactions ENABLE ROW LEVEL SECURITY;

-- Payer puede ver sus propios escrows
CREATE POLICY "payer_read" ON escrow_transactions
  FOR SELECT
  USING (payer_user_id = auth.uid());

-- Service role puede todo (operador backend)
CREATE POLICY "service_all" ON escrow_transactions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Índices para queries frecuentes
CREATE INDEX IF NOT EXISTS idx_escrow_status     ON escrow_transactions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_escrow_payer      ON escrow_transactions(payer_user_id);
CREATE INDEX IF NOT EXISTS idx_escrow_escrow_id  ON escrow_transactions(escrow_id);
```

**Aplicar:**
```bash
supabase db push
# o si no tienes CLI local:
# pegar en Supabase Dashboard → SQL Editor
```

---

## Wave 3 — UI Banner + My Calls

### 3a. Componente: `src/features/agents/components/EscrowInfoBanner.tsx`

```tsx
export function EscrowInfoBanner() {
  return (
    <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 flex items-start gap-3">
      <span className="text-xl">⏳</span>
      <div>
        <p className="text-sm font-semibold text-yellow-800">
          Agente de tarea larga
        </p>
        <p className="text-sm text-yellow-700 mt-0.5">
          Este agente puede tardar hasta 24 horas. Tu pago queda protegido en escrow
          y se libera automáticamente al completar. Si algo falla, recibes un reembolso.
        </p>
      </div>
    </div>
  )
}
```

**Integración en `src/app/[locale]/models/[slug]/page.tsx`:**
- Importar `EscrowInfoBanner`
- Si `model.long_running === true`, renderizar entre el header card y `ModelCallSection`
- No modificar nada más en la page

### 3b. Badge de estado en historial (My Calls / Dashboard)

Buscar donde se listan invocaciones del usuario. Agregar columna/badge:

```tsx
// Componente inline — adaptar al componente existente de historial
function EscrowStatusBadge({ status }: { status: string | null }) {
  if (!status) return null
  const map = {
    pending:  { label: 'En escrow',   color: 'bg-yellow-100 text-yellow-700' },
    released: { label: 'Completado',  color: 'bg-green-100 text-green-700'  },
    refunded: { label: 'Reembolsado', color: 'bg-blue-100 text-blue-700'   },
    disputed: { label: 'En disputa',  color: 'bg-red-100 text-red-700'     },
  } as const
  const s = map[status as keyof typeof map]
  if (!s) return null
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.color}`}>
      {s.label}
    </span>
  )
}
```

**Query a agregar** en el componente de historial (LEFT JOIN):
```sql
SELECT i.*, et.status as escrow_status, et.result_data
FROM invocations i
LEFT JOIN escrow_transactions et ON et.agent_slug = i.agent_slug 
  AND et.payer_user_id = i.user_id
  AND et.created_at > i.created_at - interval '1 minute'
  AND et.created_at < i.created_at + interval '1 minute'
WHERE i.user_id = auth.uid()
ORDER BY i.created_at DESC
```

---

## Variables de Entorno (agregar a `.env.local` y Vercel)

```env
# WAS-72 Escrow
WASI_ESCROW_ADDRESS=0x...          # Deploy en Fuji post Wave 0
OPERATOR_PRIVATE_KEY=0x...         # Wallet del operador (ya existe para Marketplace)
FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
INTERNAL_API_SECRET=<uuid-v4-secreto>   # Para /internal/escrow/release-expired
```

---

## Deploy del Contrato (Wave 0, paso final)

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2/contracts

# Compilar
forge build

# Deploy en Fuji
forge create src/WasiEscrow.sol:WasiEscrow \
  --rpc-url fuji \
  --private-key $OPERATOR_PRIVATE_KEY \
  --constructor-args $FUJI_USDC_ADDRESS $WASI_MARKETPLACE_ADDRESS \
  --verify

# Guardar el address en .env.local como WASI_ESCROW_ADDRESS
```

---

## Definition of Done

- [ ] `forge test --match-contract WasiEscrowTest` → 100% pass, 0 warnings
- [ ] `forge build` → 0 errores en WasiEscrow.sol
- [ ] `supabase db push` → migración 034 aplicada sin errores
- [ ] `npm run build` → 0 errores TypeScript
- [ ] WasiEscrow desplegado en Fuji, address en env vars
- [ ] POST /api/v1/agents/[slug]/invoke-long retorna 202 con escrow_id
- [ ] GET /api/v1/escrow/[id]/status retorna status correcto
- [ ] Banner visible en model page cuando long_running=true
- [ ] Badge de estado en historial para escrows existentes
- [ ] `git push origin master && git push origin master:main`

---

## Archivos a Crear (resumen)

```
contracts/src/WasiEscrow.sol                              ← Wave 0
contracts/test/WasiEscrow.t.sol                           ← Wave 0
supabase/migrations/034_escrow.sql                        ← Wave 2
src/lib/contracts/escrow.ts                               ← Wave 1
src/app/api/v1/agents/[slug]/invoke-long/route.ts         ← Wave 1
src/app/api/v1/escrow/[escrowId]/status/route.ts          ← Wave 1
src/app/api/v1/internal/escrow/release-expired/route.ts   ← Wave 1
src/features/agents/components/EscrowInfoBanner.tsx        ← Wave 3
```

## Archivos a Modificar

```
src/app/[locale]/models/[slug]/page.tsx   ← Wave 3 (solo agregar EscrowInfoBanner)
[componente historial invocaciones]        ← Wave 3 (agregar EscrowStatusBadge)
```

## Archivos PROHIBIDO tocar

```
contracts/src/WasiAIMarketplace.sol   ← NO modificar
contracts/test/WasiAIMarketplace.t.sol ← NO modificar
```
