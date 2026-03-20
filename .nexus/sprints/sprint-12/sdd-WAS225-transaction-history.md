# SDD WAS-225: Transaction History

> SPEC_APPROVED: no
> Fecha: 2026-03-17
> Tipo: feature
> SDD_MODE: full
> Clasificación: HU-MAJOR

---

## 1. Resumen

Agregar endpoint `GET /api/creator/transactions` y componente `TransactionHistory` en el creator dashboard para mostrar settlements, withdrawals y calls recibidas. Datos de `key_batch_settlements`, `agent_calls`, `creator_withdrawal_vouchers`.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **Issue** | WAS-225 |
| **Tipo** | feature |
| **Scope IN** | `GET /api/creator/transactions`, componente `TransactionHistory`, integración en dashboard |
| **Scope OUT** | Filtros, export CSV, notificaciones push |
| **Dependencia** | WAS-190 (tx_hash links — puede mergearse junto) |

### Acceptance Criteria
1. THE endpoint SHALL requerir JWT; IF ausente THEN 401
2. WHEN llamado THEN retornar `{ data: [...], total: N, page: N, per_page: 20 }`
3. Settlements: `{ type: "settlement", date, call_count, total_usdc, tx_hash }`
4. Withdrawals: `{ type: "withdrawal", date, amount_usdc, tx_hash }`
5. Calls: `{ type: "call", date, agent_slug, amount_usdc, status }`
6. WHEN creator visita dashboard THEN mostrar sección `TransactionHistory`
7. WHEN sin transacciones THEN mostrar empty state
8. IF sin wallet THEN mostrar solo type `call`
9. WHEN página fuera de rango THEN `{ data: [], total: N, page: N, per_page: 20 }`
10. IF no-creator THEN 403

---

## 3. Context Map

### Archivos leídos
| Archivo | Patrón extraído |
|---------|-----------------|
| `src/app/api/creator/analytics/route.ts` | Auth pattern: `createClient()` → `getUser()` → 401 si !user → 403 si no-creator |
| `src/app/[locale]/creator/dashboard/page.tsx` | Patrón Suspense: importar componente async + wrapping en `<Suspense fallback={<Skeleton/>}>` |
| `src/app/[locale]/creator/dashboard/_components/EarningsSection.tsx` | Patrón de sub-componente async: `createClient()` → query → render |
| `src/app/api/creator/earnings/voucher/route.ts` | Columnas de `creator_withdrawal_vouchers`: `creator_id, wallet_address, gross_amount_usdc, nonce, deadline, status` |

### Tablas y columnas verificadas
| Tabla | Columnas relevantes |
|-------|---------------------|
| `key_batch_settlements` | `id, key_id, tx_hash, total_usdc, call_count, status, confirmed_at` |
| `agent_calls` | `id, agent_id, agent_slug, amount_paid, status, called_at, settlement_batch_id` |
| `creator_withdrawal_vouchers` | `id, creator_id, wallet_address, gross_amount_usdc, nonce, deadline, status, created_at, tx_hash` — tx_hash existe (migration 043) |
| `agents` | `id, slug, creator_id` — necesario para filtrar calls por creator |

### Nota WAS-190
`creator_withdrawal_vouchers` SÍ tiene columna `tx_hash TEXT` (migration 043). Los links de Snowtrace aplican a AMBOS tipos: settlements (`key_batch_settlements.tx_hash`) y withdrawals (`creator_withdrawal_vouchers.tx_hash`). WAS-190 se implementa en el mismo componente.

### Nota key_id
`key_batch_settlements.key_id` es tipo `TEXT NOT NULL` en DB, NO UUID. Tipar como `string` en TypeScript.

### Exemplar
| Para crear | Seguir patrón de | Razón |
|-----------|------------------|-------|
| `GET /api/creator/transactions/route.ts` | `src/app/api/creator/analytics/route.ts` | Mismo auth pattern, misma estructura de response |
| `TransactionHistory.tsx` | `src/app/[locale]/creator/dashboard/_components/EarningsSection.tsx` | Mismo patrón async sub-componente con Suspense |

---

## 4. Diseño Técnico

### 4.1 Archivos a crear/modificar

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `src/app/api/creator/transactions/route.ts` | Crear | Endpoint GET con auth + paginación |
| `src/app/[locale]/creator/dashboard/_components/TransactionHistory.tsx` | Crear | Async sub-componente |
| `src/app/[locale]/creator/dashboard/page.tsx` | Modificar | Agregar `<Suspense>` con `TransactionHistory` |

### 4.2 Wave 0 — Pre-flight (Builder)
- [ ] Verificar que `src/app/api/creator/transactions/` no existe
- [ ] Verificar columnas de `key_batch_settlements` en DB (ya verificado: id, key_id, tx_hash, total_usdc, call_count, confirmed_at)
- [ ] Verificar que `creator_withdrawal_vouchers` NO tiene tx_hash (confirmar scope de WAS-190)
- [ ] Confirmar patrón auth en `analytics/route.ts` líneas 46-48

### 4.3 Wave 1 — Endpoint `GET /api/creator/transactions`

```typescript
// src/app/api/creator/transactions/route.ts
export async function GET(request: NextRequest) {
  // 1. Auth (patrón analytics/route.ts)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // 2. Paginación
  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const perPage = 20

  // 3. Obtener agents del creator para filtrar calls
  const serviceClient = createServiceClient()
  const { data: agentRows } = await serviceClient
    .from('agents').select('id, slug').eq('creator_id', user.id)
  const agentIds = (agentRows ?? []).map(a => a.id)
  const slugMap = Object.fromEntries((agentRows ?? []).map(a => [a.id, a.slug]))

  // 4. Obtener settlements (key_batch_settlements via agent_calls join)
  // 5. Obtener withdrawals (creator_withdrawal_vouchers)
  // 6. Merge, ordenar por fecha desc, paginar
  // 7. Verificar wallet para filtrado (AC8)
}
```

**Build gate Wave 1:** `npx tsc --noEmit` sin errores nuevos

### 4.4 Wave 2 — Componente TransactionHistory

```typescript
// src/app/[locale]/creator/dashboard/_components/TransactionHistory.tsx
// Patrón: EarningsSection.tsx — async Server Component
export async function TransactionHistory({ userId }: { userId: string }) {
  // fetch GET /api/creator/transactions internamente via createClient()
  // render tabla/lista con items
}
export function TransactionHistorySkeleton() { /* animate-pulse */ }
```

**Build gate Wave 2:** `npx tsc --noEmit` sin errores nuevos

### 4.5 Wave 3 — Integración en dashboard

Agregar en `dashboard/page.tsx`:
```tsx
<Suspense fallback={<TransactionHistorySkeleton />}>
  <TransactionHistory userId={user.id} />
</Suspense>
```

**Build gate Wave 3:** `npx next build` exit 0

---

## 5. Constraint Directives

### OBLIGATORIO
- Usar `createClient()` + `getUser()` para auth (nunca anon key)
- Usar `createServiceClient()` para queries cross-table (RLS bypass controlado)
- Patrón Suspense para el componente (igual que EarningsSection)
- Paginación: 20 por página, page param en query string

### PROHIBIDO
- NO exponer datos de otros creators
- NO retornar raw DB errors al cliente
- NO modificar tablas existentes (solo reads)
- NO usar service role key en client-side
- NO tipar `key_id` como UUID (es TEXT en DB)

---

## 6. Rollback

```bash
git revert HEAD  # revertir commit
# Los archivos nuevos no afectan código existente — rollback es seguro.
# Si se agregó Suspense en page.tsx, también revertir ese cambio.
```
