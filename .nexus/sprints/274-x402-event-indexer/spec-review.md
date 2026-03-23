# Spec Review — SDD #096: x402 Event Indexer (WAS-274)

> Reviewer: Spec Reviewer (subagent)
> Fecha: 2026-03-22
> Status: REVIEW_COMPLETE — 2 bloqueantes, 3 medios, 2 bajos

---

## Resumen Ejecutivo

El SDD está sólido en estructura y cubre correctamente el problema del `slug` indexado en `AgentInvoked`. Sin embargo, hay **2 findings críticos** que el Builder DEBE resolver antes de implementar: el contrato tiene dos rutas de settlement y solo una escribe `settlement_tx_hash`, lo que hace que la estrategia de matching del AC-3 falle en producción. Además, el env var del contrato tiene discrepancia entre archivos.

---

## Wave 0 Pre-flight

| Check | Estado | Notas |
|-------|--------|-------|
| `on_chain_recorded` existe en prod schema | ✅ | `00000000000006_agents_marketplace.sql` line 42 |
| `caller_wallet` existe en prod schema | ✅ | `00000000000006_agents_marketplace.sql` line 44 |
| `settlement_tx_hash` existe en prod schema | ✅ | `012_key_receipts.sql` line 14 |
| `app_settings` tabla accesible vía service client | ✅ | RLS solo permite SELECT para anon; service role bypasa RLS |
| `increment_pending_earnings` RPC existe | ✅ | `015_onboarding-fields.sql` |
| Archivos exemplar existen | ✅ | `settle-key-batches/route.ts`, `reconcile-onchain/route.ts` |
| `MARKETPLACE_CONTRACT_ADDRESS` env var referenciada correctamente | ⚠️ | Ver Finding #2 |
| Seed block definido concretamente | ⚠️ | Ver Finding #4 |
| `tsc --noEmit` baseline | ⬜ | No verificado (requiere build) |

---

## Findings

### 🔴 CRÍTICO-1: `settlement_tx_hash` NO se escribe en `admin/settlement` route

**Descripción:**
El AC-3 dice que el indexer matcheará `KeyCallSettled` events por `settlement_tx_hash = log.transactionHash`. Esto funciona para calls settladas vía el cron `settle-key-batches` (usa `runSettlement.ts` que SÍ escribe `settlement_tx_hash` en línea 234). PERO la ruta `POST /api/admin/settlement` (acción `run`) NO escribe `settlement_tx_hash` — solo actualiza `settled_at`.

**Evidencia:**
```bash
grep -c "settlement_tx_hash" src/app/api/admin/settlement/route.ts
# → 0 (ninguna ocurrencia)
```

El código del admin settlement route actualiza:
```typescript
await supabase.from('agent_calls').update({ settled_at: new Date().toISOString() }).in('id', batchCallIds)
// settlement_tx_hash NUNCA se escribe aquí
```

**Impacto:**
- 156 `KeyCallSettled` events on-chain en producción
- Si alguno fue settlado via admin panel, esas calls tienen `settlement_tx_hash = NULL` o `PENDING_WALLET_SENTINEL`
- El indexer no podrá matchearlas → quedan con `on_chain_recorded = false` para siempre
- AC-3 no cumplido para esas calls

**Acción requerida (fuera del scope del Builder según SDD, pero debe documentarse):**
El SDD dice explícitamente "Scope OUT: settlement route changes". Sin embargo, el Builder debe conocer esta limitación y documentarla en el código del indexer como un warning en el log cuando no se encuentren matches.

**Alternativa para el indexer:**
Para `KeyCallSettled`, considerar matching secundario por `(agent_slug = event.slug AND settled_at IS NOT NULL AND settlement_tx_hash IS NULL)` para capturar calls settladas via admin panel. Pero esto es ambiguo si hay múltiples calls del mismo slug.

**Severidad:** CRÍTICO — afecta la completitud del AC-3 en producción actual.

---

### 🔴 CRÍTICO-2: Env var name para `publicClient` no está en el SDD

**Descripción:**
El SDD (Section 6, OBLIGATORIO) dice "NO hardcodear el contract address (usar env var)" y lista `MARKETPLACE_CONTRACT_ADDRESS` como dependencia. Esto está correcto para la dirección del contrato.

Sin embargo, el SDD no especifica los env vars necesarios para crear el `publicClient` (chain ID y RPC URL). El exemplar `reconcile-onchain/route.ts` usa:
- `process.env.NEXT_PUBLIC_CHAIN_ID` → determina mainnet vs testnet
- `process.env.NEXT_PUBLIC_RPC_MAINNET` → URL del RPC de Avalanche
- `process.env.NEXT_PUBLIC_RPC_TESTNET` → URL del RPC de Fuji

Sin estos, el `publicClient` usará el RPC público por defecto de viem para Avalanche, que puede fallar por rate limits y no garantiza el límite de 2048 blocks.

**Acción requerida:**
El SDD debe agregar a la sección de Dependencias:
```
- NEXT_PUBLIC_CHAIN_ID (43114 mainnet)
- NEXT_PUBLIC_RPC_MAINNET (Avalanche RPC URL)
```

**Severidad:** CRÍTICO — sin RPC URL configurado, el indexer fallará en producción bajo carga.

---

### 🟡 MEDIO-1: Seed block no está definido concretamente

**Descripción:**
El SDD dice "Contract deployment block para mainnet: Se determina al primer deploy. Fallback: `latest - 1_000_000`". Esto no es suficiente para el Builder.

- El contrato mainnet es `0x9316E902760f2c37CDA57c8Be01358D890a26276` en Avalanche C-Chain 43114
- El Builder necesita el deployment block concreto para hardcodearlo como `SEED_BLOCK`
- `latest - 1_000_000` ≈ 81M - 1M = 80M blocks — pero el contrato puede ser más antiguo
- Si el seed es demasiado reciente, se pierden eventos históricos (incluyendo los 156 `KeyCallSettled` ya en chain)

**Acción requerida:**
Determinar el deployment block del contrato antes de implementar. Se puede obtener con:
```bash
# Via Snowtrace API
curl "https://api.snowtrace.io/api?module=contract&action=getcontractcreation&contractaddresses=0x9316E902760f2c37CDA57c8Be01358D890a26276"
```

El Builder debe hardcodear este valor como constante en el código.

**Severidad:** MEDIO — si no se resuelve, el backfill inicial puede ser incompleto.

---

### 🟡 MEDIO-2: AC-4 idempotencia no está completamente especificada para `AgentInvoked`

**Descripción:**
El AC-4 dice "SHALL skip without error or duplicate" para logs con `on_chain_recorded = true`. Sin embargo, la lógica de idempotencia para `AgentInvoked` orphan calls (AC-2) requiere también verificar por `tx_hash` ANTES de insertar, no solo el flag `on_chain_recorded`.

El flujo correcto debería ser:
1. Buscar `agent_calls` por `tx_hash = log.transactionHash`
2. Si existe → update `on_chain_recorded = true` (no insert)
3. Si NO existe → insert orphan call

El SDD describe esto en el flujo (4.3), pero la Wave 1 no menciona explícitamente este orden. Un Builder podría implementar `INSERT ... ON CONFLICT DO NOTHING` que silencia el error pero no actualiza el flag.

**Acción requerida:**
Agregar pseudocódigo más explícito en Wave 1 para el caso de idempotencia.

**Severidad:** MEDIO — puede causar datos duplicados o flags incorrectos.

---

### 🟡 MEDIO-3: `KeyCallSettled` emite UN evento POR call en el batch, no por tx

**Descripción:**
El SDD dice para `KeyCallSettled`: "Match against `agent_calls` rows with `settlement_tx_hash` = log `transactionHash`". Esto es correcto en concepto — una tx de `settleKeyBatch` emite N eventos `KeyCallSettled`, uno por cada (keyId, slug) en el batch.

Sin embargo, el SDD no especifica cómo evitar procesar la misma tx múltiples veces si el indexer la ve en diferentes chunks (edge case: tx cerca del borde de chunk). El lock y el `last_indexed_block` deberían prevenir esto, pero no está explicitado.

Más importante: cuando se hace `UPDATE agent_calls SET on_chain_recorded = true WHERE settlement_tx_hash = $1`, esto actualizará TODAS las calls de esa tx, pero el indexer recibirá un evento por cada call. Esto significa N queries al DB por la misma tx hash. El SDD debería indicar al Builder que agrupe por `transactionHash` antes de hacer el UPDATE.

**Acción requerida:**
Indicar que los `KeyCallSettled` events deben agruparse por `transactionHash` antes del UPDATE para minimizar DB round-trips.

**Severidad:** MEDIO — ineficiencia, no incorrección. Pero con 156 events podría ser N=156 queries innecesarias.

---

### 🟢 BAJO-1: `app_settings` RLS no tiene política de escritura

**Descripción:**
La migración 073 habilita RLS en `app_settings` con solo una policy `SELECT USING (true)`. No hay `INSERT` ni `UPDATE` policy.

El SDD dice "Usar `createServiceClient()` (no anon client) para DB writes" — el service role bypasa RLS, así que esto NO es un problema en runtime.

**Acción requerida:**
Ninguna para el Builder. Pero el SDD podría documentar esto como la razón de por qué se require service client (no es solo buenas prácticas, es funcional).

**Severidad:** BAJO — informacional, no blocking.

---

### 🟢 BAJO-2: `vercel.json` schedule `*/5 * * * *` — puede ser agresivo

**Descripción:**
El SDD propone schedule `*/5 * * * *` (cada 5 minutos). Con `maxDuration` implícito de 60s en Vercel Hobby, y el lock de 5 minutos (AC-10), esto funciona correctamente — si un run toma más de 5 min, el lock previene el siguiente.

Sin embargo, el lock se basa en timestamp (< 5 min). Si el run termina en 10s, el siguiente cron a los 5 min sí ejecutará. Esto es el comportamiento deseado para catch-up. OK.

El SDD no especifica `maxDuration` para el nuevo endpoint. El exemplar `reconcile-onchain` tiene `export const maxDuration = 120`. Con 25 chunks × 200ms delay = 5s mínimo + RPC time, puede superar los 60s del default de Vercel.

**Acción requerida:**
El Builder DEBE agregar `export const maxDuration = 300` (o al menos 120) al cron endpoint.

**Severidad:** BAJO — sin esto, el cron puede ser killed por Vercel antes de completar.

---

## Verificaciones Especiales

### ✅ `slug` en `AgentInvoked` — keccak256 handling
El SDD **SÍ maneja esto correctamente** en la sección 4.4. Identifica el problema, propone Opción A (lookup table DB → keccak256 map), y la documenta como la decisión elegida. El ABI confirma: `slug` en `AgentInvoked` es `indexed: true` → topics[1] = keccak256(slug). La Opción A es correcta.

### ⚠️ `settlement_tx_hash` matching — ver CRÍTICO-1
El campo SÍ existe en la tabla. El campo SÍ se escribe en `runSettlement.ts`. Pero NO se escribe en `admin/settlement route`. Parcialmente funcional.

### ✅ Columnas en `agent_calls` — todas existen
- `on_chain_recorded` → `00000000000006_agents_marketplace.sql:42` ✅
- `caller_wallet` → `00000000000006_agents_marketplace.sql:44` ✅
- `settlement_tx_hash` → `012_key_receipts.sql:14` ✅

### ✅ SDD NO crea funciones SQL
Correcto. El SDD solo usa `createServiceClient()` para UPDATE/INSERT. Ninguna función SQL nueva. ✅

---

## AC → Wave Trazabilidad

| AC | Wave | Estado |
|----|------|--------|
| AC-1: Auth + last_indexed_block | Wave 1+2 | ✅ cubierto |
| AC-2: AgentInvoked orphan | Wave 1 | ✅ cubierto (con caveat de MEDIO-2) |
| AC-3: KeyCallSettled reconciliation | Wave 1 | ⚠️ parcialmente (CRÍTICO-1) |
| AC-4: Idempotency | Wave 1 | ⚠️ incompleto (MEDIO-2) |
| AC-5: Creator earnings orphan only | Wave 1 | ✅ cubierto |
| AC-6: Block pagination ≤2048 | Wave 1 | ✅ cubierto |
| AC-7: Error resilience granular | Wave 1 | ✅ cubierto |
| AC-8: Seed block | Wave 0+1 | ⚠️ seed block sin valor concreto (MEDIO-1) |
| AC-9: Timeout guard (25 chunks) | Wave 1 | ✅ cubierto |
| AC-10: Concurrent lock | Wave 1 | ✅ cubierto |
| AC-11: Gas tracking (nice-to-have) | — | ✅ marcado como opcional |

---

## Decisión

**BLOQUEADO para Builder** hasta que:

1. **CRÍTICO-1** sea resuelto o explícitamente aceptado con una estrategia documentada de fallback para calls sin `settlement_tx_hash`
2. **CRÍTICO-2** sea resuelto agregando los env vars al SDD
3. **MEDIO-1** (seed block) sea resuelto con el deployment block concreto

Los findings MEDIO-2, MEDIO-3 y los BAJO pueden ser resueltos durante la Wave 1 con notas al Builder.

---

*Spec Review generado por NexusAgil Spec Reviewer — WAS-274*
