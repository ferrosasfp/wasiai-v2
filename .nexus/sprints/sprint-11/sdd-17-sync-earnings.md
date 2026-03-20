# SDD #17: sync pending_earnings_usdc para creators con wallet después de api_key settlement

> SPEC_APPROVED: no
> Fecha: 2026-03-17
> Tipo: bugfix
> SDD_MODE: full
> Branch: main (direct commit)

---

## 1. Resumen

Cuando el cron `settle-key-batches` liquida calls de api_key on-chain via `settleKeyBatch`, el contrato registra earnings del creator correctamente (90% creator / 10% platform). Pero `runSettlement` NO actualiza `pending_earnings_usdc` en la DB para creators con wallet configurada.

Resultado: el dashboard muestra menos de lo que el creator tiene derecho a retirar, y el voucher firma por menos. La brecha crece con cada ejecución del cron.

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 17 (Engram) |
| **Tipo** | bugfix |
| **SDD_MODE** | full |
| **Objetivo** | Sincronizar `pending_earnings_usdc` en DB después de settlement on-chain exitoso para creators con wallet |
| **Reglas de negocio** | Creator share = amount - (amount × platformFeeBps / 10000). Fee se lee del contrato con fallback a env var. |
| **Scope IN** | `runSettlement.ts` — bloque post-settlement de walletCalls |
| **Scope OUT** | x402 flow (ya funciona), noWalletCalls path (ya funciona), UI, contrato |
| **Missing Inputs** | N/A |

### Acceptance Criteria (EARS)

1. WHEN `settleKeyBatchOnChain` retorna txHash exitoso para walletCalls, THE sistema SHALL incrementar `pending_earnings_usdc` del creator por el creator share
2. WHEN calculando creator share, THE sistema SHALL leer `platformFeeBps` del contrato via `getPlatformFeeBps()`. IF lectura on-chain falla, THEN THE sistema SHALL usar fallback `PLATFORM_FEE_BPS` env var (default 1000) y loggear warning.
3. IF `increment_pending_earnings` RPC falla, THEN THE sistema SHALL loggear error pero NO revertir el settlement (non-blocking)
4. WHEN el advisory lock previene ejecución concurrente, THE sistema SHALL retornar `settled: 0` sin modificar earnings (comportamiento existente, no cambiar)
5. THE código SHALL documentar la asimetría x402 (100%) vs api_key (90%) con comentario explicativo

## 3. Context Map (Codebase Grounding)

### Archivos leídos
| Archivo | Por qué | Patrón extraído |
|---------|---------|-----------------|
| `src/lib/settlement/runSettlement.ts` | Archivo a modificar | Path `noWalletCalls` (línea ~152) es el exemplar: acumula por creator, llama `increment_pending_earnings` |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Referencia x402 | Línea ~529: incrementa por `creatorPrice` (100% del price_per_call). Fire-and-forget pattern. |
| `src/lib/contracts/marketplaceClient.ts` | Lectura de fee | `getPendingEarnings` es el patrón para read on-chain. Necesita función análoga para `platformFeeBps`. |
| `contracts/src/WasiAIMarketplace.sol` | Contrato fuente | `settleKeyBatch`: `creatorShare = amounts[i] - (amounts[i] * platformFeeBps / 10_000)` |

### Exemplars
| Para crear/modificar | Seguir patrón de | Razón |
|---------------------|------------------|-------|
| Post-settlement sync (walletCalls) | `noWalletCalls` block (mismo archivo, línea ~152) | Mismo patrón: acumular Map<creatorId, amount>, iterar, llamar RPC |
| `getPlatformFeeBps()` | `getPendingEarnings()` en marketplaceClient.ts | Mismo patrón: readContract, return number, catch → default |

### Estado de BD relevante
| Tabla | Existe | Columnas relevantes |
|-------|--------|---------------------|
| `creator_profiles` | Sí | `pending_earnings_usdc` (incrementado via RPC) |
| `agent_calls` | Sí | `amount_paid`, `agent_slug`, `settled_at` |

## 4. Diseño Técnico

### 4.1 Archivos a crear/modificar

| Archivo | Acción | Descripción | Exemplar |
|---------|--------|-------------|----------|
| `src/lib/contracts/marketplaceClient.ts` | Modificar | Agregar `getPlatformFeeBps()` | `getPendingEarnings()` mismo archivo |
| `src/lib/settlement/runSettlement.ts` | Modificar | Agregar sync earnings post-settlement para walletCalls | `noWalletCalls` block mismo archivo |

### 4.2 Modelo de datos

Sin cambios de BD. Usa RPC existente `increment_pending_earnings`.

### 4.3 Flujo principal (Happy Path)

1. Cron ejecuta `runSettlement`
2. Encuentra calls api_key unsettled, agrupa por key
3. Para walletCalls: llama `settleKeyBatchOnChain` → tx exitosa
4. **NUEVO:** Lee `platformFeeBps` del contrato (con cache por ejecución del cron)
5. **NUEVO:** Calcula creator share por call: `amount - (amount × feeBps / 10000)`
6. **NUEVO:** Agrupa por creatorId, llama `increment_pending_earnings` por cada creator
7. Marca calls como settled en DB

### 4.4 Flujo de error

1. Si `getPlatformFeeBps()` falla → usa fallback env/default 1000 bps, loggea warning
2. Si `increment_pending_earnings` falla → loggea error, continúa (non-blocking)
3. Si settlement on-chain falla → no se incrementa nada (txHash null → skip)

## 5. Constraint Directives (Anti-Alucinación)

### OBLIGATORIO seguir
- Patrón `noWalletCalls` para la acumulación por creator
- Patrón `getPendingEarnings()` para la lectura on-chain
- Fire-and-forget: nunca bloquear settlement por fallo de sync
- Documentar asimetría: x402 → 100% (no split on-chain), api_key → 90% (split en contrato)

### PROHIBIDO
- NO hardcodear `1000` como platformFeeBps sin fallback documentado
- NO modificar el path de `noWalletCalls` (ya funciona)
- NO modificar el flujo x402 en `invoke/route.ts`
- NO agregar dependencias nuevas
- NO cambiar la firma de `runSettlement` ni su return type

## 6. Scope

**IN:**
- `getPlatformFeeBps()` en marketplaceClient.ts
- Post-settlement earnings sync en runSettlement.ts
- Comentario documentando asimetría x402/api_key

**OUT:**
- Flujo x402 (ya funciona)
- Path noWalletCalls (ya funciona)
- UI de earnings
- Contrato
- Tests (se agregan en wave separada)

## 7. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| platformFeeBps cambia on-chain sin actualizar env fallback | Baja | Media — earnings calculados con fee incorrecto | Leer del contrato como fuente primaria; env es solo fallback |
| Doble ejecución del cron | Baja | Alta — doble increment | Advisory lock existente previene esto (settlement_lock) |
| RPC falla al leer fee | Baja | Baja — usa fallback | Log warning + fallback a constante |
| noWalletCalls incrementa por 100% vs walletCalls por 90% | N/A | Diseño intencional | Documentar con comentario: noWallet = no split on-chain, wallet = split on-chain |

## 8. Dependencias

- SDD #16 debe estar implementado primero (waitForTransactionReceipt asegura que solo se sync earnings para tx confirmadas)

---

*SDD generado por NexusAgil — FULL*
