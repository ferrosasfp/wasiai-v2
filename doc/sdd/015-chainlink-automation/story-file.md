# Story File #015 — WAS-53: Chainlink Automation Integration
> Architect · SPEC_APPROVED · 2026-03-01
> Dev SOLO lee este archivo. No consultar SDD ni Work Item.

---

## Goal
Agregar `checkUpkeep` y `performUpkeep` al contrato WasiAIMarketplace para integración con Chainlink Automation. `performUpkeep` es un trigger/señal — actualiza `lastUpkeepTimestamp` y emite `UpkeepPerformed`. El settlement real sigue siendo el Vercel cron / admin panel (WAS-78). Redesplegar en Fuji y actualizar Vercel env.

---

## Acceptance Criteria

| # | AC |
|---|---|
| AC1 | WHEN Chainlink llama `checkUpkeep`, THE contrato SHALL retornar `upkeepNeeded = true` si `block.timestamp - lastUpkeepTimestamp >= 23 hours` |
| AC2 | WHEN `upkeepNeeded = true`, THE Chainlink node SHALL poder llamar `performUpkeep` y el contrato SHALL emitir `UpkeepPerformed` |
| AC3 | WHEN el owner activa modo Chainlink en el admin panel, THE Vercel cron se omite (ya implementado en WAS-78 — no tocar) |
| AC4 | WHEN se actualiza el contrato, THE ABI en `WasiAIMarketplace.ts` SHALL incluir `checkUpkeep` y `performUpkeep` |
| AC5 | WHEN se corre `forge test`, THE 43 tests existentes SHALL seguir pasando + 2 tests nuevos para checkUpkeep |
| AC6 | WHEN se despliega en Fuji, THE nueva dirección SHALL actualizarse en Vercel env — el nuevo contrato empieza con datos en cero (reset esperado) |

---

## Archivos a crear / modificar

| Archivo | Acción |
|---|---|
| `contracts/src/WasiAIMarketplace.sol` | MODIFICAR — agregar `lastUpkeepTimestamp`, `UPKEEP_INTERVAL`, `checkUpkeep`, `performUpkeep`, evento `UpkeepPerformed` |
| `contracts/test/WasiAIMarketplace.t.sol` | MODIFICAR — agregar 2 tests nuevos |
| `src/lib/contracts/WasiAIMarketplace.ts` | MODIFICAR — agregar checkUpkeep y performUpkeep al ABI |
| `doc/sdd/015-chainlink-automation/deploy-notes.md` | CREAR — instrucciones deploy + registro Upkeep |

---

## Wave 1 — Modificar contrato

### contracts/src/WasiAIMarketplace.sol

**Paso 1 — Agregar variables de estado** (después de `lastOperatorActivity`):
```solidity
/// Timestamp del último upkeep ejecutado por Chainlink Automation
uint256 public lastUpkeepTimestamp;

/// Intervalo mínimo entre upkeeps (23h para no chocar con el cron diario de 02:00 UTC)
uint256 public constant UPKEEP_INTERVAL = 23 hours;
```

**Paso 2 — Inicializar en constructor** (al final del constructor, antes del cierre `}`):
```solidity
lastUpkeepTimestamp = block.timestamp;
```

**Paso 3 — Agregar funciones** (en la sección `// ─── Views ───` o antes del cierre del contrato):
```solidity
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
    lastUpkeepTimestamp  = block.timestamp;
    lastOperatorActivity = block.timestamp;
    emit UpkeepPerformed(block.timestamp, msg.sender);
}
```

**Paso 4 — Agregar evento** (en la sección `// ─── Events ───`):
```solidity
/// @notice Emitido cuando Chainlink Automation ejecuta performUpkeep
event UpkeepPerformed(uint256 indexed timestamp, address indexed performer);
```

---

## Wave 2 — Tests

### contracts/test/WasiAIMarketplace.t.sol — agregar al final (antes del cierre `}`):

```solidity
// ─── Chainlink Automation tests ───────────────────────────────────────────

function testCheckUpkeepFalseBeforeInterval() public {
    // Recién desplegado — lastUpkeepTimestamp = block.timestamp
    // No han pasado 23h → upkeepNeeded debe ser false
    (bool upkeepNeeded, ) = marketplace.checkUpkeep("");
    assertFalse(upkeepNeeded, "Should not need upkeep before interval");
}

function testCheckUpkeepTrueAfterInterval() public {
    // Avanzar el tiempo 23h + 1 segundo
    vm.warp(block.timestamp + 23 hours + 1);
    (bool upkeepNeeded, ) = marketplace.checkUpkeep("");
    assertTrue(upkeepNeeded, "Should need upkeep after interval");
}

function testPerformUpkeepUpdatesTimestamp() public {
    vm.warp(block.timestamp + 23 hours + 1);
    uint256 before = marketplace.lastUpkeepTimestamp();
    marketplace.performUpkeep("");
    assertGt(marketplace.lastUpkeepTimestamp(), before, "Timestamp should update");
}

function testPerformUpkeepRevertsBeforeInterval() public {
    vm.expectRevert("WasiAI: upkeep not needed");
    marketplace.performUpkeep("");
}
```

---

## Wave 3 — ABI TypeScript

### src/lib/contracts/WasiAIMarketplace.ts

Agregar ANTES de `] as const` (al final del array ABI):

```typescript
  // ── Chainlink Automation ────────────────────────────────────────────────
  {
    name: 'checkUpkeep',
    type: 'function',
    stateMutability: 'view',
    inputs:  [{ name: 'checkData', type: 'bytes' }],
    outputs: [
      { name: 'upkeepNeeded', type: 'bool'  },
      { name: 'performData',  type: 'bytes' },
    ],
  },
  {
    name: 'performUpkeep',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs:  [{ name: 'performData', type: 'bytes' }],
    outputs: [],
  },
  {
    name: 'lastUpkeepTimestamp',
    type: 'function',
    stateMutability: 'view',
    inputs:  [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'UpkeepPerformed',
    type: 'event',
    inputs: [
      { name: 'timestamp', type: 'uint256', indexed: true  },
      { name: 'performer', type: 'address', indexed: true  },
    ],
  },
```

---

## Wave 4 — Deploy Fuji + verificar

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2/contracts

# 1. Run tests — todos deben pasar
~/.foundry/bin/forge test -vv

# 2. Deploy nuevo contrato en Fuji
~/.foundry/bin/forge script script/Deploy.s.sol \
  --rpc-url $FUJI_RPC_URL \
  --broadcast \
  --verify \
  --verifier sourcify

# 3. Capturar nueva dirección del output y actualizar Vercel
~/.npm-global/bin/vercel env rm MARKETPLACE_CONTRACT_ADDRESS preview --yes 2>/dev/null || true
~/.npm-global/bin/vercel env rm MARKETPLACE_CONTRACT_ADDRESS production --yes 2>/dev/null || true
echo "NEW_ADDRESS" | ~/.npm-global/bin/vercel env add MARKETPLACE_CONTRACT_ADDRESS preview
echo "NEW_ADDRESS" | ~/.npm-global/bin/vercel env add MARKETPLACE_CONTRACT_ADDRESS production
```

⚠️ Reemplazar `NEW_ADDRESS` con la dirección real del deploy output.

---

## Wave 5 — Deploy notes

### doc/sdd/015-chainlink-automation/deploy-notes.md

```markdown
# Deploy Notes — WAS-53 Chainlink Automation

## Contrato desplegado
- Red: Avalanche Fuji (chainId 43113)
- Dirección: [COMPLETAR TRAS DEPLOY]
- Verificado: Sourcify

## IMPORTANTE — Alcance de performUpkeep
En esta versión, performUpkeep emite el evento UpkeepPerformed
y actualiza lastUpkeepTimestamp — el settlement REAL sigue
ejecutándose desde el Vercel cron (o manualmente desde el admin panel).
Chainlink Automation demuestra la integración con el sponsor sin
rediseñar el sistema de settlement. Un listener de eventos on-chain
queda fuera de scope para Sprint 7.

## Registro del Upkeep en Chainlink (acción manual de Fer)
1. Ir a https://automation.chain.link
2. Conectar wallet del operador
3. "Register new Upkeep" → Custom logic
4. Contract address: [nueva dirección]
5. Gas limit: 200000
6. Funding: mínimo 5 LINK (testnet LINK desde faucet)
7. El Upkeep llamará checkUpkeep cada bloque — ejecutará performUpkeep cuando upkeepNeeded = true

## LINK Faucet Fuji
https://faucets.chain.link/fuji
```

---

## Wave 6 — Typecheck + commit

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2
npx tsc --noEmit   # 0 errores

git add -A
git commit -m "feat(WAS-53): Chainlink Automation checkUpkeep/performUpkeep + Fuji redeploy"
git push origin master master:main
```

---

## Constraint Directives

**OBLIGATORIO:**
- `checkUpkeep` y `performUpkeep` firmas exactas — compatibles con IAutomationCompatibleInterface
- `lastUpkeepTimestamp` inicializado en constructor con `block.timestamp`
- `forge test` — 43 tests existentes + 4 nuevos = 47 total, todos verdes
- Desplegar nuevo contrato Fuji, verificar Sourcify, actualizar Vercel env `MARKETPLACE_CONTRACT_ADDRESS`
- CD-4: documentar en deploy-notes que performUpkeep es trigger/señal, no settlement real

**PROHIBIDO:**
- NO modificar `settleKeyBatch` ni su modificador `onlyOperator`
- NO agregar dependencia npm/lib de Chainlink — la interfaz es inline (firmas puras)
- NO tocar la lógica del cron ni del admin panel (WAS-78 ya lo maneja)
- NO romper los 43 tests existentes

## Variables de entorno Fuji para el script de deploy
```
FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
PRIVATE_KEY=$OPERATOR_PRIVATE_KEY  (en .env.local)
```

## Escalation Rule
Si el script `Deploy.s.sol` no existe — buscar en `contracts/script/` el script correcto antes de asumir el nombre.
Si `forge test` falla en tests existentes por el constructor (nuevo parámetro) — leer el constructor actual completo antes de modificarlo.
