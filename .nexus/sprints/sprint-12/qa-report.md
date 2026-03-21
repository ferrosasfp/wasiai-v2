# QA Report — Sprint 12

**Fecha:** 2026-03-17  
**Verifier:** QA Subagent (NexusAgile v1.3)  
**Commits revisados:** `f0f042aad`, `924888ed6`, `edc3cd7ee`

---

## Drift Detection

| Dimensión | Esperado | Real | Status |
|-----------|----------|------|--------|
| `src/app/api/creator/transactions/route.ts` | CREADO | ✅ Existe | PASS |
| `src/app/[locale]/creator/dashboard/_components/TransactionHistory.tsx` | CREADO | ✅ Existe | PASS |
| `src/app/[locale]/creator/dashboard/page.tsx` | MODIFICADO | ✅ Importa + usa TransactionHistory | PASS |
| `src/app/api/v1/onboard/start/route.ts` | CREADO | ✅ Existe | PASS |
| `src/app/api/v1/onboard/step/route.ts` | CREADO | ✅ Existe | PASS |
| `src/app/api/v1/onboard/[session_id]/route.ts` | CREADO | ✅ Existe | PASS |

**Resultado:** 6/6 archivos presentes. Sin drift.

---

## AC Verification — WAS-225 (Transaction History)

| AC | Cumple | Evidencia archivo:línea |
|----|--------|------------------------|
| 1. JWT auth → 401 si ausente | ✅ | `route.ts:52-53` — `if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })` |
| 2. GET retorna `{ data, total, page, per_page: 20 }` paginado | ✅ | `route.ts:138-143` — retorna `{ data: slice, total, page, per_page: PER_PAGE }` con `PER_PAGE=20` (línea 17) |
| 3. Settlements: `{ type:"settlement", date, call_count, total_usdc, tx_hash }` | ✅ | `route.ts:88-95` — push con todos los campos requeridos |
| 4. Withdrawals: `{ type:"withdrawal", date, amount_usdc, tx_hash }` | ✅ | `route.ts:104-110` — push con todos los campos requeridos |
| 5. Calls: `{ type:"call", date, agent_slug, amount_usdc, status }` | ✅ | `route.ts:120-128` — push con todos los campos requeridos |
| 6. Sección TransactionHistory en dashboard con Suspense | ✅ | `page.tsx:171-174` — `<Suspense fallback={<TransactionHistorySkeleton />}><TransactionHistory userId={user.id} /></Suspense>` |
| 7. Empty state cuando no hay transacciones | ✅ | `TransactionHistory.tsx:152-158` — `{items.length === 0 ? <div>No transactions yet</div> : ...}` |
| 8. Sin wallet → solo type "call" | ✅ | `route.ts:79-113` — settlements y withdrawals solo si `hasWallet`; calls siempre |
| 9. Página fuera de rango → `{ data:[], total:N, page:N, per_page:20 }` | ✅ | `route.ts:130-143` — `allItems.slice(offset, offset+PER_PAGE)` retorna `[]` cuando offset > total; `total` y `page` preservados |
| 10. No-creator → 403 | ✅ | `route.ts:57-59` — `if (!profile) return NextResponse.json({ error: 'forbidden' }, { status: 403 })` |

**Resultado: 10/10 ✅**

---

## AC Verification — WAS-190 (Links Snowtrace)

| AC | Cumple | Evidencia archivo:línea |
|----|--------|------------------------|
| 1. tx_hash válido → link con `explorerTx(tx_hash)` — settlement Y withdrawal | ✅ | `TransactionHistory.tsx:191-200` — `href={explorerTx(item.tx_hash)}` aplicado cuando `item.type === 'settlement' \|\| item.type === 'withdrawal'` y `isValidTxHash(item.tx_hash)` |
| 2. `target="_blank" rel="noopener noreferrer"` | ✅ | `TransactionHistory.tsx:193-194` — atributos presentes en el `<a>` |
| 3. tx_hash inválido/null → no mostrar link (regex `/^0x[0-9a-fA-F]{64}$/`) | ✅ | `TransactionHistory.tsx:10-12` — `TX_HASH_REGEX = /^0x[0-9a-fA-F]{64}$/`; `isValidTxHash` lo aplica; fallback `<span>—</span>` en línea 203 |

**Resultado: 3/3 ✅**

---

## AC Verification — WAS-232 (Onboarding Wizard)

| AC | Cumple | Evidencia archivo:línea |
|----|--------|------------------------|
| 1. POST /start → rate limit 429 | ✅ | `start/route.ts:7-9` — `checkRateLimit(getAgentSignupLimit(), identifier)` retorna 429 si excede límite |
| 2. POST /start → HTTP 201 con `{ session_id, step:1, total_steps:7, question, hint }` | ✅ | `start/route.ts:26-34` — `NextResponse.json({...}, { status: 201 })` con todos los campos |
| 3. POST /step → 404 si session no existe o expirada | ✅ | `step/route.ts:56-62` — query con `.gt('expires_at', ...)` + `if (sessionError \|\| !session) → 404` |
| 4. POST /step → 409 si status=completed | ✅ | `step/route.ts:64-66` — `if (session.status === 'completed') → 409` |
| 5. POST /step → 400 si answer vacío/null | ✅ | `step/route.ts:46-48` — `if (answer === null \|\| answer === undefined \|\| answer === '') → 400` |
| 6. POST /step step3 → ping inline (sin probeEndpoint), warning si falla pero avanza | ✅ | `step/route.ts:100-117` — `fetch(answer, { signal: AbortSignal.timeout(5000) })` inline; si falla: actualiza step y retorna con `warning`, no bloquea |
| 7. POST /step step7 → email duplicado 409 | ✅ | `step/route.ts:163-170` — detecta `User already registered` / `already exists` / status 422 → 409 |
| 8. POST /step step7 → agent insert failure → rollback + 500 (NO devolver key) | ✅ | `step/route.ts:215-224` — rollback: `delete agent_keys` + `deleteUser`; retorna 500 sin `agent_key` en body |
| 9. POST /step step7 → slug collision resuelta con suffix hex | ✅ | `step/route.ts:187-192` — `randomBytes(3).toString('hex')` como suffix si slug ya existe |
| 10. GET /:session_id → `{ current_step, status, completed_fields }` | ✅ | `[session_id]/route.ts:18-22` — retorna exactamente esos 3 campos; `completed_fields: Object.keys(session.data ?? {})` |
| 11. GET /:session_id → 404 si no existe | ✅ | `[session_id]/route.ts:14-16` — `if (error \|\| !session) → 404` |

**Resultado: 11/11 ✅**

---

## Build Gates

- **TSC (`npx tsc --noEmit`):** ✅ PASS — 0 errores `error TS`
- **Tests:**
  - `settle-key-batches.test.ts`: 12/12 ✅
  - `settlement-failure-serialization.test.ts`: 7/7 ✅
  - **Total: 19/19 passing**

---

## Veredicto: ✅ APROBADO

Todos los ACs verificados con evidencia concreta. Sin drift de archivos. Build limpio. Tests en verde.

| Story | ACs | Status |
|-------|-----|--------|
| WAS-225 | 10/10 | ✅ APROBADO |
| WAS-190 | 3/3 | ✅ APROBADO |
| WAS-232 | 11/11 | ✅ APROBADO |
