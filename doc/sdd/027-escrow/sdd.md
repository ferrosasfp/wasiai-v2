# SDD-027 — Escrow para Tareas Largas (WAS-72)

**Estado:** SPEC_APPROVED  
**Modo:** QUALITY  
**Fecha:** 2026-03-02  
**Architect:** San (NexusAgil)

---

## 0. Context Map (Codebase Grounding)

| Archivo | Líneas clave | Qué aprendimos |
|---|---|---|
| `contracts/src/WasiAIMarketplace.sol` | 1-360 | Patrón onlyOperator, storage layout con earnings/keyBalances, recordInvocation split, SafeERC20, ReentrancyGuard, Ownable2Step |
| `contracts/test/WasiAIMarketplace.t.sol` | 1-100 | MockUSDC con transferWithAuthorization sin sig verification, setUp pattern con vm.prank, helpers _fundKey/_registerAgent |
| `contracts/foundry.toml` | 1-18 | solc 0.8.24, remappings OZ + Chainlink, RPC fuji = avax-test |
| `src/app/api/v1/agents/[slug]/invoke/route.ts` | 1-95 | Proxy thin a /models/[slug]/invoke, X-API-Key → x-agent-key, AbortSignal 30s timeout |
| `supabase/migrations/033_agent_wallets.sql` | 1-18 | Tabla agent_wallets, RLS USING(false), numeración siguiente = 034 |
| `src/app/[locale]/models/[slug]/page.tsx` | 1-80 | ModelCallSection, AgentTrialPlayground, free_trial_enabled badge, grid 3 columnas |

---

## 1. Decisiones de Arquitectura

### D1 — Contrato separado `WasiEscrow` (NO extensión de WasiAIMarketplace)

**Decisión:** Contrato independiente `WasiEscrow.sol`.

**Análisis:**

| Criterio | Extensión | Separado ✅ |
|---|---|---|
| Storage layout | Rompe layout existente con nuevas vars | Limpio, propio namespace |
| Upgradability | Dificulta futuras actualizaciones al contrato ya auditado | Cada contrato se actualiza independientemente |
| Surface de ataque | Agranda el contrato principal con lógica temporal | Aislado; bug en escrow no toca earnings/keyBalances existentes |
| Complejidad tests | Tests de marketplace se mezclan con escrow | Test files separados, más claros |
| Integración | recordInvocation ya existe | WasiEscrow emite evento; backend llama recordInvocation tras release |
| Deploy en Fuji | Un solo contrato ya desplegado no necesita redeployar | Deploy nuevo sin afectar el existente |

**Implementación:** WasiEscrow recibe USDC, lo retiene, y al hacer release transfiere al contrato WasiAIMarketplace (que ya contiene la lógica de split). El backend llama `recordInvocation` después de que el USDC llegue al Marketplace.

---

### D2 — Auto-release 24h: Endpoint protegido por operador

**Decisión:** Endpoint interno `POST /api/v1/internal/escrow/release-expired` protegido con `INTERNAL_API_SECRET`. Disparado manualmente por operador o integrado con el upkeep-listener existente (WAS-82).

**Justificación:**
- No hay Chainlink Automation en Fuji (solo mainnet → WAS-79)
- Vercel Hobby = 2/2 crons ya ocupados; agregar un tercero no es viable
- El upkeep-listener de WAS-82 puede hacer un fetch a este endpoint como "side effect" de su ciclo
- Para Fuji (testnet) el trigger manual es suficiente — no hay SLA de producción
- El contrato `WasiEscrow` sí implementa `releaseExpired(escrowId)` que cualquier address puede llamar después de `RELEASE_TIMEOUT` (prueba de que el tiempo pasó on-chain). El endpoint es conveniencia, no custodia.

---

### D3 — Marcar agente como long_running: campo en tabla `agents`

**Decisión:** Campo `long_running BOOLEAN NOT NULL DEFAULT false` en tabla `agents` (migración 034).

**Justificación:**
- Persistente y visible en UI sin cambiar cliente
- Creator lo activa al publicar/editar el agente (no por invocación)
- Evita lógica adicional en el invoke route que ya es thin proxy
- Permite filtrar en marketplace ("Agentes de tareas largas")
- Alternativa (parámetro en invoke) requería cambiar ABI de request, documentación y todos los clientes — innecesario para Fuji

---

## 2. Diseño del Contrato `WasiEscrow`

### 2.1 Storage

```solidity
struct EscrowTx {
    address payer;          // quien pagó
    string  slug;           // agente invocado
    uint256 amount;         // USDC en atomic units
    uint256 createdAt;      // block.timestamp del depósito
    EscrowStatus status;    // Pending | Released | Refunded | Disputed
}

enum EscrowStatus { Pending, Released, Refunded, Disputed }

mapping(bytes32 => EscrowTx) public escrows;  // escrowId → tx
IERC20 public immutable usdc;
address public immutable marketplace;          // WasiAIMarketplace address
mapping(address => bool) public operators;

uint256 public constant RELEASE_TIMEOUT = 24 hours;
```

### 2.2 Funciones

| Función | Quién llama | Descripción |
|---|---|---|
| `createEscrow(escrowId, slug, payer, amount, validAfter, validBefore, nonce, v, r, s)` | onlyOperator | Mueve USDC del payer al contrato via ERC-3009. Crea EscrowTx en Pending. |
| `releaseEscrow(escrowId)` | onlyOperator | Libera USDC al Marketplace (ya auditado). Backend llama recordInvocation después. |
| `releaseExpired(escrowId)` | cualquiera | Igual que releaseEscrow pero solo si `block.timestamp > createdAt + RELEASE_TIMEOUT`. Trustless fallback. |
| `refundEscrow(escrowId)` | onlyOperator | Devuelve USDC al payer. Usado si el agente falla o se cancela. |
| `disputeEscrow(escrowId)` | onlyOperator | Marca como Disputed. Resolución manual fuera de chain. |
| `setOperator(address, bool)` | onlyOwner | Gestión de operadores. |

### 2.3 Eventos

```solidity
event EscrowCreated(bytes32 indexed escrowId, string slug, address indexed payer, uint256 amount);
event EscrowReleased(bytes32 indexed escrowId, address indexed to, uint256 amount);
event EscrowRefunded(bytes32 indexed escrowId, address indexed to, uint256 amount);
event EscrowDisputed(bytes32 indexed escrowId);
```

---

## 3. Diseño Backend

### 3.1 Nuevos Endpoints

#### `POST /api/v1/agents/[slug]/invoke-long`
- Igual al invoke normal pero para agentes long_running
- Verifica `agents.long_running = true`
- Llama al contrato `createEscrow` vía viem v2 (operador wallet — mismo patrón que `marketplaceClient.ts`)
- Inserta row en `escrow_transactions` con status `pending`
- Retorna `{ escrow_id, estimated_completion, status: "pending" }`

#### `GET /api/v1/escrow/[escrowId]/status`
- Público (autenticado con API key del payer)
- Consulta `escrow_transactions` en Supabase
- Retorna status actual + resultado cuando está disponible

#### `POST /api/v1/internal/escrow/release-expired`
- Header: `Authorization: Bearer ${INTERNAL_API_SECRET}`
- Busca escrows en Supabase con status `pending` y `created_at < now() - 24h`
- Para cada uno: llama `releaseExpired(escrowId)` en contrato
- Llama `recordInvocation` en WasiAIMarketplace
- Actualiza `escrow_transactions.status = 'released'`
- Retorna `{ released: n, errors: [] }`

### 3.2 Archivos a crear/modificar

| Archivo | Acción |
|---|---|
| `src/app/api/v1/agents/[slug]/invoke-long/route.ts` | Crear nuevo |
| `src/app/api/v1/escrow/[escrowId]/status/route.ts` | Crear nuevo |
| `src/app/api/v1/internal/escrow/release-expired/route.ts` | Crear nuevo |
| `src/lib/contracts/escrow.ts` | Crear — wrapper viem v2 para WasiEscrow (seguir patrón de `marketplaceClient.ts`) |

---

## 4. Migración SQL 034

```sql
-- 034_escrow.sql
-- Agrega long_running a agents y crea escrow_transactions

ALTER TABLE agents ADD COLUMN IF NOT EXISTS long_running BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS escrow_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id       TEXT NOT NULL UNIQUE,    -- bytes32 hex del contrato
  agent_slug      TEXT NOT NULL,
  payer_address   TEXT NOT NULL,
  payer_user_id   UUID REFERENCES auth.users(id),
  amount_usdc     NUMERIC(20,6) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','released','refunded','disputed')),
  result_data     JSONB,                   -- payload del agente al completar
  tx_create       TEXT,                    -- txHash createEscrow
  tx_release      TEXT,                    -- txHash releaseEscrow/releaseExpired
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at     TIMESTAMPTZ,
  refunded_at     TIMESTAMPTZ
);

ALTER TABLE escrow_transactions ENABLE ROW LEVEL SECURITY;

-- Payer puede ver sus propios escrows
CREATE POLICY "payer_read" ON escrow_transactions
  FOR SELECT USING (payer_user_id = auth.uid());

-- Service role puede todo (operador backend)
CREATE POLICY "service_all" ON escrow_transactions
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_escrow_status ON escrow_transactions(status, created_at);
CREATE INDEX idx_escrow_payer  ON escrow_transactions(payer_user_id);
```

---

## 5. UI — Cambios Mínimos

### 5.1 Banner en Agent Detail Page (`models/[slug]/page.tsx`)

- Si `model.long_running === true`: mostrar banner amarillo entre header y ModelCallSection
- Copy: "⏳ Este agente puede tardar hasta 24h. El pago queda en escrow y se libera al completar."
- Componente: `EscrowInfoBanner` en `src/features/agents/components/EscrowInfoBanner.tsx`
- Sin cambios al flujo de pago existente — el banner es solo informativo

### 5.2 My Calls / Historial

- Tabla `invocations` (ya existe) mostrará nueva columna `escrow_status`
- Si el escrow_id existe para esa invocación: badge de estado (Pendiente/Completado/Reembolsado)
- Componente a tocar: donde se lista el historial del usuario (buscar en dashboard)

---

## 6. ACs Técnicos Verificables

| AC | Archivo:Línea (post-impl) |
|---|---|
| WasiEscrow.sol compila con solc 0.8.24 sin warnings | `contracts/src/WasiEscrow.sol:1` + `forge build` 0 errores |
| createEscrow transfiere USDC via ERC-3009 | `contracts/src/WasiEscrow.sol:createEscrow()` |
| releaseExpired solo funciona after 24h | `contracts/src/WasiEscrow.sol:releaseExpired()` require check |
| forge test --match-contract WasiEscrow: 100% pass | `contracts/test/WasiEscrow.t.sol` |
| agents.long_running campo en DB | `supabase/migrations/034_escrow.sql:1` |
| escrow_transactions tabla con RLS | `supabase/migrations/034_escrow.sql` |
| POST invoke-long retorna escrow_id | `src/app/api/v1/agents/[slug]/invoke-long/route.ts` |
| GET escrow/[id]/status retorna status actual | `src/app/api/v1/escrow/[escrowId]/status/route.ts` |
| Banner visible si long_running=true | `src/app/[locale]/models/[slug]/page.tsx` + `EscrowInfoBanner` |

---

## 7. Constraint Directives

### OBLIGATORIO
- `WasiEscrow` hereda `Ownable2Step`, `ReentrancyGuard`, usa `SafeERC20` — igual que Marketplace
- Todas las funciones de release/refund: `nonReentrant`
- `escrow_id` = `bytes32` generado como `keccak256(abi.encodePacked(slug, payer, amount, nonce, block.chainid))` — computable off-chain
- Migración nombrada `034_escrow.sql`
- Deploy solo en Fuji (`chainId: 43113`), nunca mainnet (43114) en este PR
- Tests forge: MockUSDC existente, mismo patrón setUp con vm.prank
- `INTERNAL_API_SECRET` en `.env.local` y Vercel env vars, nunca en código

### PROHIBIDO
- NO modificar `WasiAIMarketplace.sol` en este PR
- NO usar Chainlink Automation en WasiEscrow (Fuji-only)
- NO agregar tercer Vercel Cron (plan Hobby 2/2 ocupado)
- NO exponer endpoint release-expired sin autenticación
- NO guardar private keys en escrow_transactions
- NO usar ethers.js — SIEMPRE viem v2 (pinned 2.21.0)

---

## 8. Riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| USDC queda atrapado si Marketplace se pausa | Alta | releaseExpired es trustless — cualquiera puede llamarlo tras 24h |
| Operador compromised hace releaseEscrow a wallet equivocada | Alta | releaseEscrow solo transfiere a `marketplace` address immutable |
| escrow_id colisión (nonce predecible) | Media | nonce = UUID v4 generado server-side, incluye chainId en hash |
| Vercel cold start en invoke-long demora la tx | Baja | AbortSignal 30s en fetch + retry en cliente |
| long_running false positivo (creator se equivoca) | Baja | Creator puede editar el campo en dashboard |

---

## Auto-Blindaje

### [2026-03-02]: ethers.js en código ejemplar del story file
- **Error:** El Architect generó código ejemplar para `escrow.ts` usando `ethers.js` (ethers.Contract, ethers.Wallet, ethers.JsonRpcProvider) violando el Golden Path del proyecto.
- **Fix:** Reemplazado por viem v2 con el patrón exacto de `marketplaceClient.ts` (createWalletClient, createPublicClient, privateKeyToAccount, simulateContract + writeContract).
- **Aplicar en:** Cualquier generación futura de código de contratos — siempre leer `marketplaceClient.ts` como exemplar antes de generar código de cliente on-chain.
- **Regla reforzada:** `NUNCA ethers.js` es una regla del Golden Path — verificar en Constraint Directives de cada SDD que involucre contratos.
