# Spec Review — WAS-209

**Reviewer:** NexusAgil Spec Reviewer v1.3  
**Fecha:** 2026-03-14  
**SDD:** `/home/ferdev/.openclaw/workspace/wasiai-v2/.nexus/sprints/209-discovery-enriched/sdd.md`

---

## Wave 0 Results

| Paso | Resultado | Detalle |
|---|---|---|
| 0.1 Fix ya existe | ✅ NO existe | `src/app/api/v1/capabilities/route.ts` es WAS-208 (array plano). WAS-209 no implementado. |
| 0.2 Archivos referenciados existen | ⚠️ PARCIAL | `route.ts` ✅ · `chain.ts` ✅ · `WasiAIMarketplace.ts` ✅ · `constants.ts` ✅ |
| 0.3a Imports compilables | ❌ BLOCKER | `getMarketplaceAddress()` llamada SIN argumentos, pero firma real es `getMarketplaceAddress(chainId: number)` — **error TS** garantizado |
| 0.3a CHAIN_ID / CHAIN_NAME | ✅ Existen | `CHAIN_ID` y `CHAIN_NAME` exportados correctamente en `src/lib/chain.ts` |
| 0.3b Columnas DB | ❌ CRÍTICO | `tags TEXT[]`, `erc8004_id BIGINT`, `input_schema JSONB`, `output_schema JSONB`, `reputation_count INTEGER` **NO aparecen en `doc/DB_SCHEMA.md`** — schema doc no las lista |
| 0.4 Dependencias | ✅ OK | No hay nuevas deps — usa supabase, next/server, libs existentes |
| 0.5 TODOs/Ambigüedades | ⚠️ 3 items | Ver sección Findings |

---

## Coherencia

| Check | Estado | Detalle |
|---|---|---|
| AC → Wave trazabilidad | ✅ OK | AC-1..9 todos cubiertos en Wave 1 |
| Build gate Wave 1 | ✅ Definido | `npx tsc --noEmit` — pero fallará por F-01 |
| Rollback ejecutable | ✅ OK | `git checkout HEAD~1 -- src/app/api/v1/capabilities/route.ts` — sin migraciones |
| Constraints específicas | ✅ OK | Prohibiciones claras y bien delimitadas |
| Un solo archivo modificado | ✅ OK | Scope bien contenido |
| AC-4 escala min_reputation | ✅ OK | Constraint documenta: DB 0-100, API 0.0-1.0, code aplica `* 100` correctamente |

---

## Findings

| # | Severidad | Detalle | Corrección |
|---|---|---|---|
| F-01 | 🔴 BLOCKER | `getMarketplaceAddress()` llamada sin args en Wave 1 code. Firma real: `getMarketplaceAddress(chainId: number)`. Compilación falla con `TS2554: Expected 1 arguments, but got 0`. | Cambiar a `getMarketplaceAddress(CHAIN_ID)` |
| F-02 | 🔴 BLOCKER | `doc/DB_SCHEMA.md` no lista `tags`, `erc8004_id`, `input_schema`, `output_schema`, `reputation_count` en tabla `agents`. El SDD las marca como "confirmado ✅" pero el schema canónico no las tiene. Builder no puede verificar que existen. | Actualizar DB_SCHEMA.md con las columnas faltantes antes de build, O confirmar via `SELECT column_name FROM information_schema.columns WHERE table_name='agents'` |
| F-03 | 🟠 HIGH | Tag filter es **client-side** después de paginación. Fetch retorna `limit+1` rows sin filtrar por tag, luego filtra client-side. Si hay 100 agentes y solo 2 tienen `tag=oracle`, con `limit=20` el fetch trae 21 rows de las que solo algunas tienen el tag — pagination se rompe (next_cursor incorrecto, results < limit aunque existan más). | Usar filtro server-side: Supabase soporta `query.contains('tags', [tag])` para TEXT[]. Para case-insensitive, usar RPC o `textSearch`. Alternativa mínima: agregar `?tag` como parámetro al RPC `discover_agents_v2` si ya existe. |
| F-04 | 🟡 MEDIUM | `erc8004.identity_id` mapeado desde `creator_wallet` (TEXT, Ethereum address). Pero `erc8004_id` es BIGINT (on-chain token ID de ERC-8004). El campo `identity_id` debería ser el token ID, no la wallet del creador. Semánticamente incorrecto. | Mapear `a.erc8004_id?.toString() ?? null` en `identity_id`. Si se quiere la wallet, renombrar el campo a `creator_wallet` en la respuesta. |
| F-05 | 🟡 MEDIUM | `CHAIN_NAME` exporta `'avalanche'` para mainnet (no `'avalanche-mainnet'`). AC-5 muestra `"chain": "avalanche-mainnet"` como ejemplo. El código usa `CHAIN_NAME ?? 'avalanche-mainnet'` — el fallback nunca ejecuta (CHAIN_NAME siempre definido). Resultado real: `"chain": "avalanche"`. Si x402 SDK u otros consumidores esperan `'avalanche-mainnet'`, habrá runtime mismatch. | Verificar qué valor espera el x402 SDK. Si es `'avalanche'`, corregir AC-5 en el SDD. Si es `'avalanche-mainnet'`, agregar mapeo en el code. |
| F-06 | 🟢 LOW | `USDC_MAINNET` const definida localmente en el handler (`'0xB97EF9Ef...'`) pero **nunca usada** en el código de Wave 1. La dirección USDC ya existe en `chain.ts` como `USDC_ADDRESS`. Dead code + duplicación. | Eliminar la const local y usar `import { USDC_ADDRESS } from '@/lib/chain'` si se necesita. |
| F-07 | 🟢 LOW | Rollback documenta `git checkout HEAD~1 -- ...` pero si hay más de 1 commit entre HEAD y el estado pre-WAS-209, el rollback apunta al commit equivocado. | Usar `git stash` o anotar el commit SHA actual en el SDD antes de build. Mejor: `git show HEAD:src/app/api/v1/capabilities/route.ts > route.ts.bak` como backup explícito. |

---

## Veredicto

### ❌ NECESITA CORRECCIÓN

**Bloqueantes antes de build:**

1. **F-01** — Corregir `getMarketplaceAddress()` → `getMarketplaceAddress(CHAIN_ID)` en Wave 1 code
2. **F-02** — Actualizar `doc/DB_SCHEMA.md` con columnas faltantes o confirmar existencia vía SQL
3. **F-03** — Reemplazar tag filter client-side por filter server-side (`.contains('tags', [tag])`)
4. **F-04** — Corregir `identity_id`: usar `erc8004_id` no `creator_wallet`

**Recomendados (no bloqueantes):**

5. **F-05** — Aclarar valor esperado de `CHAIN_NAME` por x402 SDK
6. **F-06** — Eliminar `USDC_MAINNET` dead code
7. **F-07** — Mejorar estrategia rollback con SHA o backup explícito
