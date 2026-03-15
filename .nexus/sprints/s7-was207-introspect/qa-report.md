# QA Report — WAS-207 Introspect
**Sprint:** S7 | **Fecha:** 2026-03-14 | **Verifier:** NexusAgil v1.3 QA Bot
**Commits verificados:** `079731c46` (inicial) + `eeeddaa1f` (BUG-01 + BUG-02 fix)

---

## Build Verification

```
npx tsc --noEmit → (sin output = sin errores)
```
**✅ BUILD CLEAN** — 0 errores TypeScript.

---

## ACs Verificados

### AC1 — POST /introspect → 200 con COB firmado (state_snapshots, call_trace, memory_diffs, operator_signature, truncated)
**CUMPLE ✅**

- `buildCOB.ts:22-30` — Interface `COB` define explícitamente: `state_snapshots`, `call_trace`, `memory_diffs`, `operator_signature`, `truncated`.
- `route.ts:265` (Route A / agent key) → `return NextResponse.json({ cob, meta ... })` — status 200 por defecto.
- `route.ts:310` (Route B / x402) → idem.
- `buildCOB.ts:95-100` — `buildCOB()` retorna el COB con `operator_signature` incluido (null si falla signing, pero campo presente).

---

### AC2 — depth=shallow → $0.10, mid → $0.25, full → $0.50 (en respuesta 402)
**CUMPLE ✅**

- `route.ts:42-46`:
  ```ts
  const INTROSPECT_PRICE: Record<IntrospectDepth, number> = {
    shallow: 0.10,
    mid:     0.25,
    full:    0.50,
  }
  ```
- `route.ts:88` — `build402Response` usa `INTROSPECT_PRICE[depth].toFixed(6)` → precio correcto por depth.
- `route.ts:94` — `buildRequirements` convierte a atomic USDC (`* 1_000_000`) y lo embebe en el JSON 402.

---

### AC3 — Sin payment → 402 con precio correcto para el depth solicitado
**CUMPLE ✅**

- `route.ts:285-288`:
  ```ts
  if (!paymentHeader) {
    logger.info('[introspect] probe', { slug, depth: body.depth })
    return build402Response(slug, body.depth)
  }
  ```
- `build402Response` usa `INTROSPECT_PRICE[depth]` → el 402 lleva el precio exacto del depth pedido.

---

### AC4 — operator_signature = keccak256(COB) firmado por operator wallet
**CUMPLE ✅**

- `buildCOB.ts:72-75` (función `signCOB`):
  ```ts
  const hash = keccak256(toBytes(JSON.stringify(cob)))
  return await account.signMessage({ message: { raw: toBytes(hash) } })
  ```
- Se firma el hash keccak256 del JSON del COB con la clave del operator wallet (viem `privateKeyToAccount`).
- Si `OPERATOR_PRIVATE_KEY` no está configurada, retorna `null` (no-fatal, COB se retorna igual per SDD).

---

### AC5 — depth shallow/mid → memory_diffs incremental (no full blob)
**CUMPLE ✅**

- `buildCOB.ts:54-66` (función `assembleCOB`):
  ```ts
  if (opts.depth === 'full') {
    memoryDiffs = raw
  } else {
    // Incremental: solo entradas con "delta" o "diff", máx 10 (shallow) / 20 (mid)
    memoryDiffs = raw
      .filter((e) => typeof e === 'object' && e !== null && ('delta' in e || 'diff' in e))
      .slice(0, opts.depth === 'mid' ? 20 : 10)
  }
  ```
- `full` → blob completo. `mid` → máx 20 entries incremental. `shallow` → máx 10.

---

### AC6 — Upstream timeout → COB parcial con truncated: true. Upstream error (no timeout) → COB vacío con truncated: false
**CUMPLE ✅** (BUG-01 fix en `eeeddaa1f`)

- `route.ts:167-173` (`callUpstreamIntrospect`): detecta timeout via `AbortError`/`TimeoutError` → `timedOut: true`.
- `route.ts:237-242` (Route A, también ~294-299 Route B):
  ```ts
  upstreamData: upstream.timedOut ? upstream.data : (upstream.status === 'error' ? {} : upstream.data),
  truncated:    upstream.timedOut === true,
  ```
  - **Timeout** → `upstreamData = upstream.data` (datos parciales capturados), `truncated = true` ✅
  - **Error sin timeout** → `upstreamData = {}` (COB vacío), `truncated = false` ✅

---

### AC7 — Agent key con budget suficiente → procesa sin 402 (budget deducido ANTES del upstream call)
**CUMPLE ✅** (BUG-02 fix en `eeeddaa1f`)

- `route.ts:226-231`:
  ```ts
  // BUG-02 fix: deduct budget atomically BEFORE calling upstream
  const deductResult = await supabase.rpc('check_and_deduct_budget', {
    p_key_id: keyRow.id,
    p_amount: price,
  })
  ```
- `route.ts:237`: `// Call upstream — budget already deducted`
- El RPC `check_and_deduct_budget` es atómico (Supabase PG function). Si falla → 402 sin llegar al upstream.

---

## Resumen

| AC | Descripción | Evidencia | Estado |
|----|-------------|-----------|--------|
| 1 | 200 + COB firmado con todos los campos | route.ts:265,310 / buildCOB.ts:22-30,95-100 | ✅ CUMPLE |
| 2 | Precios shallow/mid/full correctos | route.ts:42-46, 88 | ✅ CUMPLE |
| 3 | Sin payment → 402 precio por depth | route.ts:285-288 | ✅ CUMPLE |
| 4 | operator_signature = keccak256(COB) | buildCOB.ts:72-75 | ✅ CUMPLE |
| 5 | memory_diffs incremental en shallow/mid | buildCOB.ts:54-66 | ✅ CUMPLE |
| 6 | timeout→truncated:true / error→truncated:false | route.ts:237-242 | ✅ CUMPLE |
| 7 | Budget deducido ANTES del upstream call | route.ts:226-237 | ✅ CUMPLE |

---

## Veredicto

# 🟢 QA PASS

Todos los ACs verificados con evidencia concreta. Build limpio. BUG-01 y BUG-02 corregidos correctamente en `eeeddaa1f`.
