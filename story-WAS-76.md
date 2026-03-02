# Story WAS-76: Paginación en Recent Calls del Creator Dashboard

**Status:** ready-for-dev  
**Sprint:** 14 | **Épica:** Epic UX — Dashboard Improvements  
**Prioridad:** P2 | **Estimación:** S (~2–3 horas)  
**Dependencias:** Ninguna

---

## Historia de usuario

Como creator en el dashboard, cuando tengo muchas invocaciones registradas, quiero ver las últimas 10 calls y poder navegar a páginas anteriores, para no ver una lista interminable que sea difícil de leer.

---

## Acceptance Criteria

1. **Recent Calls muestra exactamente 10 registros por página** por defecto.
2. Hay controles de paginación: botones **Anterior / Siguiente** con el número de página actual.
3. Si hay 10 o menos registros totales, **no se muestran los controles de paginación**.
4. El estado de la página se mantiene en la URL con query param `?callsPage=N` para que sea compartible y no se pierda al recargar.
5. La query a Supabase usa `.range(offset, offset + 9)` — no trae todos los registros al frontend.
6. Funciona correctamente en mobile (botones accesibles, no se cortan).

---

## Situación actual

**Archivo:** `src/app/[locale]/creator/dashboard/page.tsx`

La query actual trae hasta 20 registros sin paginación:
```ts
.limit(20)
```

El render muestra todos de un golpe con `recentCalls.map(...)`.

---

## Cambios requeridos

### 1. Server Component — `page.tsx`

Recibir `callsPage` desde `searchParams` y hacer la query paginada:

```ts
// Props del page
interface DashboardPageProps {
  params: { locale: string }
  searchParams: { callsPage?: string }
}

// En el body del page:
const CALLS_PER_PAGE = 10
const callsPage = Math.max(1, parseInt(searchParams.callsPage ?? '1', 10))
const callsOffset = (callsPage - 1) * CALLS_PER_PAGE

// Query paginada con count total:
const recentCallsData = modelIds.length > 0
  ? await serviceClient
      .from('agent_calls')
      .select('id, agent_id, caller_type, amount_paid, status, latency_ms, called_at, agent:agents(name, slug)', { count: 'exact' })
      .in('agent_id', modelIds)
      .order('called_at', { ascending: false })
      .range(callsOffset, callsOffset + CALLS_PER_PAGE - 1)
  : { data: [], count: 0 }

const recentCalls: CallRow[] = (recentCallsData.data as unknown as CallRow[]) ?? []
const totalCallsCount = recentCallsData.count ?? 0
const totalPages = Math.ceil(totalCallsCount / CALLS_PER_PAGE)
```

Pasar `callsPage`, `totalPages` al componente de paginación.

### 2. Nuevo componente — `CallsPagination.tsx`

Crear en `src/features/creator/components/CallsPagination.tsx`:

```tsx
'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

interface Props {
  currentPage: number
  totalPages: number
}

export function CallsPagination({ currentPage, totalPages }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  if (totalPages <= 1) return null

  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('callsPage', String(page))
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
      <button
        onClick={() => goToPage(currentPage - 1)}
        disabled={currentPage === 1}
        className="rounded-lg border border-gray-200 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ← Anterior
      </button>
      <span>Página {currentPage} de {totalPages}</span>
      <button
        onClick={() => goToPage(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="rounded-lg border border-gray-200 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Siguiente →
      </button>
    </div>
  )
}
```

### 3. Render en `page.tsx`

Reemplazar el bloque de Recent Calls para incluir el componente:

```tsx
<section>
  <h2 className="mb-4 font-semibold text-gray-900">{t('recentCalls')}</h2>
  {recentCalls.length === 0 ? (
    <p className="text-sm text-gray-400">{t('noCallsYet')}</p>
  ) : (
    <>
      <div className="...tabla/lista existente...">
        {recentCalls.map((call) => (
          // ... render existente sin cambios
        ))}
      </div>
      <CallsPagination currentPage={callsPage} totalPages={totalPages} />
    </>
  )}
</section>
```

---

## Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `src/app/[locale]/creator/dashboard/page.tsx` | Query paginada + pasar props + render `<CallsPagination>` |
| `src/features/creator/components/CallsPagination.tsx` | **NUEVO** — componente de paginación |

---

## DoD — Definition of Done

- [ ] Muestra máximo 10 calls por página ✓
- [ ] Botones Anterior/Siguiente funcionan correctamente ✓
- [ ] Con ≤ 10 calls totales no aparecen controles ✓
- [ ] Query usa `.range()` — no trae datos extra del DB ✓
- [ ] URL refleja la página actual con `?callsPage=N` ✓
- [ ] Funciona en mobile ✓
- [ ] `npm run build` sin errores TypeScript ✓
- [ ] Sin warnings ESLint ✓

---

## Dev Agent Record

### Agent Model Used
_(completar al implementar)_

### Completion Notes List
_(completar al implementar)_

### File List
- `src/app/[locale]/creator/dashboard/page.tsx` — MODIFICADO
- `src/features/creator/components/CallsPagination.tsx` — NUEVO
