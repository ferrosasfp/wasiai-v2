# Logic Audit — WAS-225 + WAS-190
**Auditor:** Logic Auditor — NexusAgile v1.3  
**Fecha:** 2026-03-17  
**Archivos revisados:**
- `src/app/api/creator/transactions/route.ts`
- `src/app/[locale]/creator/dashboard/_components/TransactionHistory.tsx`
- `src/app/[locale]/creator/dashboard/page.tsx`

---

## AC Trazabilidad

| AC | Descripción | Implementado | Archivo:línea | Status |
|----|-------------|--------------|---------------|--------|
| AC-1 | JWT auth → 401 si ausente | ✅ `if (!user) return 401` | route.ts:10-11 | ✅ OK |
| AC-2 | GET paginado `{ data, total, page, per_page: 20 }` | ✅ | route.ts:~80 | ✅ OK |
| AC-3 | Settlement `{ type, date, call_count, total_usdc, tx_hash }` | ✅ | route.ts:36-41 | ✅ OK |
| AC-4 | Withdrawal `{ type, date, amount_usdc, tx_hash }` | ✅ | route.ts:50-54 | ✅ OK |
| AC-5 | Call `{ type, date, agent_slug, amount_usdc, status }` | ✅ | route.ts:63-67 | ✅ OK |
| AC-6 | Sección TransactionHistory con Suspense | ✅ | dashboard/page.tsx:172-174 | ✅ OK |
| AC-7 | Empty state cuando no hay transacciones | ✅ `items.length === 0` → mensaje | TransactionHistory.tsx:139-145 | ✅ OK |
| AC-8 | Sin wallet → solo type "call" | ✅ settlements/withdrawals en bloque `if (hasWallet)` | route.ts:25-55 | ✅ OK |
| AC-9 | Página fuera de rango → `{ data: [], total: N, page: N, per_page: 20 }` | ⚠️ PARCIAL | route.ts:76-79 | ⚠️ VER F-1 |
| AC-10 | No-creator → 403 | ✅ `if (!profile) return 403` | route.ts:14-15 | ✅ OK |

---

## Findings

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| F-1 | 🟡 MEDIA | Edge case / AC-9 | **Página fuera de rango no valida NaN.** Si `?page=abc`, `parseInt('abc', 10)` retorna `NaN`. `Math.max(1, NaN)` retorna `NaN`, no `1`. Resultado: `offset = NaN`, `allItems.slice(NaN, NaN)` retorna `[]`, `page: NaN` en la respuesta — viola el formato del AC-9 y puede confundir al cliente. | route.ts:18 |
| F-2 | 🟡 MEDIA | Performance / Edge case | **Full-table scan sin límite en BD.** Las queries a `key_batch_settlements`, `creator_withdrawal_vouchers` y `agent_calls` no tienen `.limit()`. Un creator con miles de registros carga **todos** en memoria y pagina en JS. Esto es un bug de escalabilidad que afecta la correctness del `total` (correcto) pero puede causar timeouts/OOM en prod. No es un bug de lógica funcional hoy, pero es un defecto de diseño que romperá el AC-2 a escala. | route.ts:29-67 |
| F-3 | 🟢 BAJA | Edge case / Sorting | **Settlement con `confirmed_at: null` se ordena al fondo (timestamp = 0)**, no al frente. Settlements pendientes (sin confirmar) aparecen al final. Puede ser intencional, pero no está especificado en el SDD. Si el negocio espera ver settlements pendientes primero, el sort es incorrecto. | route.ts:71-75 |
| F-4 | 🟢 BAJA | Error handling swallowed | **Errores de BD silenciados.** Ninguna query verifica `error` del resultado de Supabase. Si una query falla (ej. `key_batch_settlements`), `data` es `null`, el `?? []` silencia el error, y la respuesta retorna parcial sin indicación de falla. El cliente recibe 200 con data incompleta. | route.ts:29, 43, 56, 60 |
| F-5 | 🟢 BAJA | Tipos | **`parseInt` sin fallback para string vacío.** `?page=` (string vacío) → `parseInt('', 10)` = `NaN`. Mismo problema que F-1. Mitigado parcialmente por `?? '1'` que solo aplica a `null`, no a string vacío. | route.ts:18 |
| F-6 | 🟢 BAJA | WAS-190 / Cobertura | **`explorerTx()` + `isValidTxHash()` aplica correctamente a AMBOS tipos** (settlement y withdrawal) en la condición `(item.type === 'settlement' \|\| item.type === 'withdrawal') && isValidTxHash(item.tx_hash)`. Calls no tienen columna tx_hash — correcto, no se muestra link. ✅ WAS-190 implementado correctamente. | TransactionHistory.tsx:183-194 |
| F-7 | 🟢 BAJA | Duplicación de lógica | **La lógica de construcción de `allItems` está duplicada** entre `route.ts` (API) y `TransactionHistory.tsx` (Server Component). El componente hace sus propias queries en lugar de consumir la API. Esto no es un bug hoy (ambos tienen la misma lógica), pero introduce riesgo de divergencia futura. Documentar como deuda técnica. | TransactionHistory.tsx:65-130 |

---

## Detalle F-1 + F-5 (crítico para AC-9)

```typescript
// BUG: parseInt('abc') = NaN, Math.max(1, NaN) = NaN
const page = Math.max(1, parseInt(pageParam ?? '1', 10))

// Fix sugerido:
const parsed = parseInt(pageParam ?? '1', 10)
const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1
```

Con el fix, `?page=abc` → `page=1`, y una página fuera de rango legítima (ej. `?page=999` sin items) retorna `{ data: [], total: 0, page: 999, per_page: 20 }` — cumpliendo AC-9.

---

## Veredicto: ⚠️ REQUIERE CORRECCIÓN

**Bloqueantes para merge:**
- **F-1 / F-5:** Bug real — `NaN` en `page` puede causar respuestas malformadas que rompen el contrato AC-9. Fix sencillo, obligatorio.

**No bloqueantes (deuda técnica):**
- F-2: Escalar a BD-side pagination en sprint futuro.
- F-3: Clarificar con producto si settlements sin `confirmed_at` van al frente o al fondo.
- F-4: Agregar error logging/propagación en al menos los paths críticos.
- F-7: Documentar la duplicación intencional o consolidar en próximo refactor.

**WAS-190:** ✅ Implementado correctamente. `explorerTx()` con regex `/^0x[0-9a-fA-F]{64}$/` aplica a settlement y withdrawal. Calls correctamente excluidos.
