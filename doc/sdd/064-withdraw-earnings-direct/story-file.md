# Story File — #064: Withdraw Earnings Directo desde Wallet del Creator

> SDD: doc/sdd/064-withdraw-earnings-direct/sdd.md
> Fecha: 2026-03-08
> Branch: feat/064-withdraw-earnings-direct

---

## Goal

Reemplazar el flujo de retiro de earnings del creator (actualmente via operador) por una llamada directa del creator a `withdraw()` en `WasiAIMarketplace.sol`. El creator firma la tx desde su wallet — el operador ya no paga gas ni interviene.

## Acceptance Criteria (EARS)

1. WHEN el creator hace click en "Withdraw USDC →", THE UI SHALL solicitar firma de `withdraw()` directamente al creator via su wallet conectada
2. WHEN la tx es confirmada on-chain, THE API SHALL verificar el evento `Withdrawn(creator, amount)` en el receipt antes de retornar éxito
3. IF `receipt.status !== 'success'`, THEN THE UI SHALL mostrar mensaje de error y NO actualizar ningún estado de éxito
4. WHILE no hay wallet conectada (`!hasWallet || !walletAddress`), THE botón SHALL renderizarse deshabilitado con texto "Sin wallet"
5. WHEN la tx es exitosa, THE UI SHALL mostrar link al explorer con el txHash real del creator
6. IF `earnings[msg.sender] == 0`, THE contrato revertirá y THE UI SHALL mostrar el mensaje de error del revert
7. WHILE el status es `signing` o `confirming`, THE botón SHALL mostrar estado de carga animado e impedirse double-click

## Files to Modify/Create

| # | Archivo | Acción | Qué hacer | Exemplar |
|---|---------|--------|-----------|----------|
| 1 | `src/lib/contracts/abis.ts` | Modificar | Agregar `WITHDRAW_EARNINGS_ABI` después de `WITHDRAW_KEY_ABI` | `src/lib/contracts/abis.ts` (WITHDRAW_KEY_ABI como patrón) |
| 2 | `src/app/api/creator/withdraw/route.ts` | Modificar | Reescribir handler `POST`: recibir `{ txHash }`, verificar evento `Withdrawn`, retornar `{ ok, realAmount }`. `GET` sin cambios. | `src/app/api/agent-keys/[id]/withdraw/route.ts` |
| 3 | `src/app/[locale]/creator/dashboard/WithdrawButton.tsx` | Modificar | Reescribir completo: `useUnifiedWalletClient` + `writeContract` + `waitForTransactionReceipt` + estados signing/confirming/success/error + i18n | `src/app/[locale]/agent-keys/page.tsx` (WithdrawModal, ~líneas 330-480) |
| 4 | `src/app/[locale]/creator/dashboard/_components/EarningsSection.tsx` | Modificar | Agregar prop `walletAddress={profile?.wallet_address ?? ''}` al `<WithdrawButton>` | El mismo archivo (ya tiene `profile?.wallet_address`) |
| 5 | `messages/en.json` | Modificar | Agregar 5 claves al namespace `dashboard` | `messages/en.json` (claves dashboard existentes) |
| 6 | `messages/es.json` | Modificar | Agregar 5 claves al namespace `dashboard` | `messages/es.json` (claves dashboard existentes) |

## Exemplars

### Exemplar 1: WITHDRAW_KEY_ABI — patrón para el ABI
**Archivo**: `src/lib/contracts/abis.ts`
**Usar para**: Archivo #1
**Patrón clave**:
```typescript
export const WITHDRAW_KEY_ABI = [
  {
    name:            'withdrawKey',
    type:            'function' as const,
    inputs:          [
      { name: 'keyId',  type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs:         [],
    stateMutability: 'nonpayable',
  },
] as const
```
Para `WITHDRAW_EARNINGS_ABI`: mismo patrón, `name: 'withdraw'`, `inputs: []`.

### Exemplar 2: API route withdraw de agent-keys — patrón completo
**Archivo**: `src/app/api/agent-keys/[id]/withdraw/route.ts`
**Usar para**: Archivo #2
**Patrón clave**:
- Imports: `z`, `createPublicClient`, `http`, `avalancheFuji`, `avalanche` de `viem`
- `validateCsrf(req)` primero
- `supabase.auth.getUser()` para auth
- Retry loop 3× con `await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))`
- `pub.getTransactionReceipt({ hash: txHash as \`0x\${string}\` })`
- `receipt.status !== 'success'` → 400
- `log.topics[0] === TOPIC` para encontrar el evento
- `log.topics[N]?.slice(-40)` para extraer address de topic indexado
- `Number(BigInt(log.data)) / 1_000_000` para convertir amount

### Exemplar 3: WithdrawModal en agent-keys — patrón frontend
**Archivo**: `src/app/[locale]/agent-keys/page.tsx` (líneas ~330-480)
**Usar para**: Archivo #3
**Patrón clave**:
- `const { writeContract } = useUnifiedWalletClient()`
- `useState<'idle'|'signing'|'submitting'|'success'|'error'>('idle')`
- `await writeContract({ address, abi, functionName, chainId })`
- `const pub = createPublicClient({ chain: ..., transport: http() })`
- `await pub.waitForTransactionReceipt({ hash: hash as \`0x\${string}\`, confirmations: 1 })`
- `await fetch('/api/...', { method: 'POST', body: JSON.stringify({ txHash: hash }) })`
- `t('key')` para todos los strings UI

### Exemplar 4: EarningsSection — server component con props a client
**Archivo**: `src/app/[locale]/creator/dashboard/_components/EarningsSection.tsx`
**Usar para**: Archivo #4
**Patrón clave**:
```tsx
<WithdrawButton
  pending={pendingOnChain}
  hasWallet={!!profile?.wallet_address}
  // AGREGAR:
  walletAddress={profile?.wallet_address ?? ''}
/>
```
`profile?.wallet_address` ya existe en el componente (línea ~31).

## Contrato de Integración ⚠️ BLOQUEANTE

### WithdrawButton (client) → POST /api/creator/withdraw

**Request:**
```json
{
  "txHash": "0x<hash de la tx firmada por el creator>"
}
```

**Response exitoso (200):**
```json
{
  "ok": true,
  "txHash": "0x...",
  "realAmount": 12.50
}
```

**Errores:**
| HTTP | Cuándo |
|------|--------|
| 400 | Body inválido / tx no encontrada después de 3 reintentos / receipt.status !== 'success' / evento Withdrawn no encontrado |
| 401 | Usuario no autenticado |
| 403 | El evento creator no coincide con wallet_address del usuario autenticado |
| 400 | creator_profiles sin wallet_address |

---

## Constraint Directives

### OBLIGATORIO
- `WITHDRAW_EARNINGS_ABI.name` debe ser `'withdraw'` (nombre exacto de la función en el contrato)
- Seguir patrón retry 3× de `agent-keys/[id]/withdraw/route.ts` para `getTransactionReceipt`
- `WITHDRAWN_TOPIC` hardcodeado: `'0x7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d5'`
- Verificar `log.topics[1]?.slice(-40) === walletAddress.toLowerCase()` antes de retornar éxito
- `realAmount = Number(BigInt(log.data)) / 1_000_000`
- Todos los strings UI vía `useTranslations('dashboard')` — 0 hardcoded
- `isDisabled` bloquea el botón mientras `status === 'signing' || status === 'confirming'`
- `disabled={isDisabled || pending <= 0}` — botón inactivo si no hay earnings
- Usar `snowscanTx(hash)` de `@/lib/chain` para el link del explorer (no construir URL a mano)
- Si `!hasWallet || !walletAddress` → renderizar botón deshabilitado "Sin wallet"

### PROHIBIDO
- NO agregar dependencias nuevas — solo módulos ya presentes en el proyecto
- NO modificar el handler `GET /api/creator/withdraw` — solo el `POST`
- NO modificar `marketplaceClient.ts` — `withdrawForCreator` se conserva como fallback
- NO tocar archivos fuera de la tabla "Files to Modify/Create"
- NO hardcodear strings UI — todo por i18n
- NO omitir el ownership check del evento (`topics[1]` vs `walletAddress`)
- NO confiar en el `amount` del cliente — leerlo del evento on-chain (`log.data`)
- NO usar `IS_MAINNET` para construir la URL del explorer — usar `snowscanTx()` directamente

## Test Expectations

| Test | ACs que cubre | Framework | Tipo |
|------|--------------|-----------|------|
| N/A | — | — | — |

### Criterio Test-First

| Tipo de cambio | Test-first? |
|----------------|-------------|
| ABI constant | No |
| API route (POST) | No — lógica on-chain requiere mocks complejos, verificación manual |
| WithdrawButton UI | No — componente de UI |
| EarningsSection prop | No — prop pass-through |

> Justificación: la lógica crítica (verificación del evento on-chain) requiere mock de `createPublicClient` que no existe en el proyecto. La cobertura se hace via F4 manual en Fuji testnet.

## Waves

### Wave 0 (Serial Gate — completar antes de todo)
- [ ] W0.1: Agregar i18n keys a `messages/en.json` y `messages/es.json` (namespace `dashboard`):
  - `withdrawBtn`: "Withdraw USDC →" / "Retirar USDC →"
  - `withdrawSigning`: "Confirm in wallet…" / "Confirma en tu wallet…"
  - `withdrawConfirming`: "Confirming…" / "Confirmando…"
  - `withdrawViewTx`: "View tx" / "Ver tx"
  - `withdrawNoWallet`: "No wallet" / "Sin wallet"
- [ ] W0.2: Agregar `WITHDRAW_EARNINGS_ABI` a `src/lib/contracts/abis.ts`
- [ ] W0.verify: `npx tsc --noEmit` pasa ✅

### Wave 1 (Parallelizable)
- [ ] W1.1: Reescribir `POST` en `src/app/api/creator/withdraw/route.ts` → Exemplar 2
- [ ] W1.2: Reescribir `src/app/[locale]/creator/dashboard/WithdrawButton.tsx` → Exemplar 3
- [ ] W1.verify: `npx tsc --noEmit` pasa ✅

### Wave 2 (Depende de W1)
- [ ] W2.1: Agregar `walletAddress` prop en `EarningsSection.tsx` → Exemplar 4
- [ ] W2.verify: `npx tsc --noEmit` pasa ✅

### Wave 3 (QG final)
- [ ] W3.1: `npx tsc --noEmit` — 0 errores
- [ ] W3.2: `npm run lint -- --max-warnings 0`
- [ ] W3.3: `npm run build`

### Verificación Incremental

| Wave | Verificación al completar |
|------|--------------------------|
| W0 | `tsc --noEmit` pasa |
| W1 | `tsc --noEmit` pasa |
| W2 | `tsc --noEmit` pasa |
| W3 | `tsc --noEmit` + `lint` + `build` todos pasan |

## Out of Scope

- `GET /api/creator/withdraw` — sin cambios
- `marketplaceClient.ts` — `withdrawForCreator` se conserva (fallback operador)
- `creator_profiles` schema — sin cambios de BD
- Flujo x402, depósito Agent Keys, sandbox
- Tests automatizados nuevos
- NO "mejorar" el código adyacente (EarningsSection layout, estilos, etc.)
- NO agregar funcionalidad de retiro parcial (contrato solo tiene `withdraw()` total)

## Escalation Rule

> **Si algo no está en este Story File, Dev PARA y escala a Architect.**
> No inventar. No asumir. No improvisar.

Situaciones de escalation:
- Algún import de los Exemplars no existe en el proyecto
- `useUnifiedWalletClient` no tiene `writeContract` disponible
- `snowscanTx` no exporta desde `@/lib/chain`
- `EarningsSection` no tiene `profile?.wallet_address` disponible
- Hay ambigüedad en algún AC

---

*Story File generado por NexusAgil — F2.5 | Reescrito con quality_pipeline.md completo*
