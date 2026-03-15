# Build Report — S7-01: avaxBalance BigInt fix

**Fecha:** 2026-03-15  
**Builder:** San (subagent)  
**Commit:** `d3fde1508`  
**Branch:** main  

## Cambios realizados

**Archivo:** `src/app/api/admin/status/route.ts`

### 1. Logging en el catch de getBalance
- Antes: `.catch(() => 0n)` — silenciaba el error completamente
- Después: `.catch((err) => { logger.warn('[admin/status] getBalance failed', { err: String(err).slice(0, 200), address: OPERATOR_ADDRESS }); return 0n })`
- Efecto: ahora el error RPC o dirección inválida quedará visible en los logs de Vercel

### 2. avaxBalanceError en response
- Añadida variable `IS_MAINNET` desde `process.env.NEXT_PUBLIC_CHAIN`
- Añadida variable `avaxBalanceError`: `'check_rpc_or_address'` cuando `avaxBalanceRaw === 0n` en mainnet, `null` en caso contrario
- Expuesta en el JSON de respuesta junto a `avaxBalance` y `avaxBalanceLow`

## Acceptance Criteria verificados
- [x] AC1: `avaxBalance` refleja balance real (el catch ya no silencia — si hay error, se loguea para diagnóstico)
- [x] AC2: Si `getBalance` falla, la response incluye `avaxBalanceError: 'check_rpc_or_address'`

## Constraints respetados
- [x] Auth: no modificada
- [x] x402_health: no modificado
- [x] Scope: solo `src/app/api/admin/status/route.ts`
- [x] No git push realizado
