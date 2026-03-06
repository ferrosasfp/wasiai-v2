# SDD-015 — Paginación en Recent Calls del Creator Dashboard

**ID:** WAS-115  
**Fecha:** 2026-03-02  
**Modo:** QUALITY mini  
**Status:** SPEC_READY  

---

## 1. Context Map

| Archivo | Rol | Hallazgo clave |
|---------|-----|----------------|
| `src/app/[locale]/creator/dashboard/page.tsx` | Página principal (Server Component async) | Query actual usa `.limit(20)` sin paginación; `recentCalls` se pasa directo al render |
| `story-WAS-76.md` | Spec previa existente | Define ACs, patrón de query con `.range()`, componente `CallsPagination`, URL param `?callsPage=N` |
| `project-context.md` | Reglas del proyecto | TypeScript strict, sin `any`, next-intl para i18n, Tailwind, no CSS modules; App Router Server Components por defecto |

**Query actual (línea ~65 en page.tsx):**
```ts
.from('agent_calls')
.select('id, agent_id, caller_type, amount_paid, status, latency_ms, called_at, agent:agents(name, slug)')
.in('agent_id', modelIds)
.order('called_at', { ascending: false })
.limit(20)
```

**Patrón searchParams en App Router Next.js 14:**
```tsx
// page.tsx recibe searchParams como prop (no necesita useSearchParams)
export default async function CreatorDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ callsPage?: string }>
}) {
  const { locale } = await params
  const { callsPage: callsPageParam } = await searchParams
  ...
}
```

---

## 2. Objetivo + ACs en formato EARS

**Objetivo:** Cuando un creator tiene más de 10 invocaciones en su dashboard, el sistema DEBE mostrar exactamente 10 por página con controles Anterior/Siguiente, evitando traer datos extra de la DB.

| # | AC (EARS) | Criterio de éxito |
|---|-----------|-------------------|
| AC-1 | WHEN el creator abre el dashboard, THEN Recent Calls muestra exactamente 10 registros (o menos si hay < 10) | `CALLS_PER_PAGE = 10`, query con `.range(offset, offset+9)` |
| AC-2 | WHEN hay más de 10 calls totales, THEN se muestran controles Anterior / Siguiente con número de página actual | `totalPages > 1` → render `<CallsPagination>` |
| AC-3 | WHEN hay 10 o menos calls totales, THEN los controles de paginación NO aparecen | `totalPages <= 1` → `CallsPagination` retorna `null` |
| AC-4 | WHEN el creator navega de página, THEN la URL refleja `?callsPage=N` y persiste al recargar | `router.push()` con `params.set('callsPage', ...)` |
| AC-5 | WHEN se hace la query a Supabase, THEN usa `.range()` con `{ count: 'exact' }` — no trae filas extras | Verificado en code review: sin `.limit()` ni full scan |
| AC-6 | WHEN se visualiza en mobile, THEN los botones son accesibles y no se truncan | Tailwind responsive, min touch target 40px |

---

## 3. Archivos a crear/modificar

| Archivo | Operación | Descripción |
|---------|-----------|-------------|
| `src/app/[locale]/creator/dashboard/page.tsx` | MODIFICAR | Añadir `searchParams` prop, query paginada con `.range()` + `count: 'exact'`, pasar `callsPage`/`totalPages` a `<CallsPagination>` |
| `src/features/creator/components/CallsPagination.tsx` | CREAR | Client Component con `useRouter` + `useSearchParams` para navegar páginas |

### Exemplar — Modificación en `page.tsx`

```ts
// Constante al inicio del archivo (fuera del componente)
const CALLS_PER_PAGE = 10

// Props del page (Next.js 14 App Router — searchParams como Promise)
export default async function CreatorDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ callsPage?: string }>
}) {
  const { locale } = await params
  const { callsPage: callsPageParam } = await searchParams

  // ... auth, profile checks existentes ...

  const callsPage = Math.max(1, parseInt(callsPageParam ?? '1', 10))
  const callsOffset = (callsPage - 1) * CALLS_PER_PAGE

  const recentCallsData = modelIds.length > 0
    ? await serviceClient
        .from('agent_calls')
        .select(
          'id, agent_id, caller_type, amount_paid, status, latency_ms, called_at, agent:agents(name, slug)',
          { count: 'exact' }
        )
        .in('agent_id', modelIds)
        .order('called_at', { ascending: false })
        .range(callsOffset, callsOffset + CALLS_PER_PAGE - 1)
    : { data: [], count: 0 }

  const recentCalls: CallRow[] = (recentCallsData.data as unknown as CallRow[]) ?? []
  const totalCallsCount = recentCallsData.count ?? 0
  const totalPages = Math.ceil(totalCallsCount / CALLS_PER_PAGE)
```

### Exemplar — Render actualizado (sección Recent Calls en page.tsx)

```tsx
{/* Recent calls */}
<section>
  <h2 className="mb-4 font-semibold text-gray-900">{t('recentCalls')}</h2>
  {recentCalls.length === 0 && callsPage === 1 ? (
    <EmptyState icon="⚡" title={t('noCalls')} subtitle={t('noCallsSubtitle')} />
  ) : (
    <>
      <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
        {/* tabla existente sin cambios */}
      </div>
      <CallsPagination currentPage={callsPage} totalPages={totalPages} />
    </>
  )}
</section>
```

### Exemplar — `CallsPagination.tsx` (NUEVO)

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

---

## 4. Constraint Directives

### OBLIGATORIO
- `CALLS_PER_PAGE = 10` — constante definida una sola vez, fuera del componente
- Query DEBE usar `.range(offset, offset + CALLS_PER_PAGE - 1)` con `{ count: 'exact' }` — sin `.limit()`
- `searchParams` en App Router Next.js 14 llega como `Promise<{...}>` — DEBE awaitearse
- `CallsPagination` DEBE ser `'use client'` (usa hooks de navegación)
- Validar `callsPage` con `Math.max(1, parseInt(...))` — protección contra valores inválidos
- `npm run build` sin errores TypeScript ni warnings ESLint antes de cerrar

### PROHIBIDO
- ❌ NO usar `.limit()` en la query paginada (reemplaza con `.range()`)
- ❌ NO usar `any` explícito — mantener tipado `CallRow[]`
- ❌ NO traer todos los registros al frontend para paginar en memoria
- ❌ NO usar CSS modules ni styled-components — solo Tailwind
- ❌ NO agregar dependencias nuevas (sin npm install)
- ❌ NO modificar el render de la tabla interna — solo el wrapper + agregar `<CallsPagination>`
- ❌ NO hardcodear textos — si se agregan literales nuevos deben ir a `/messages/es.json` y `/messages/en.json` (aunque para "Anterior"/"Siguiente" puede usarse inline dado que ya hay precedente en el codebase)

---

## 5. Waves

### W0 — Serial (bloqueante)

| Tarea | Archivo | Detalle |
|-------|---------|---------|
| W0.1 — Crear `CallsPagination.tsx` | `src/features/creator/components/CallsPagination.tsx` | Client Component completo según exemplar |
| W0.2 — Modificar `page.tsx` | `src/app/[locale]/creator/dashboard/page.tsx` | Añadir `searchParams` prop + query paginada + import + render |

> W0.2 depende de W0.1 (necesita el import). Ejecutar en orden.

### W1 — Validación

| Tarea | Detalle |
|-------|---------|
| W1.1 — Build check | `npm run build` — 0 errores, 0 warnings TypeScript |
| W1.2 — Smoke test manual | Navegar dashboard, verificar paginación, verificar URL `?callsPage=2`, recargar y mantener página |
| W1.3 — Edge cases | 0 calls → EmptyState normal; exactamente 10 calls → sin controles; 11 calls → controles aparecen |

---

## 6. Implementation Readiness Check

| Check | Estado |
|-------|--------|
| Archivos fuente leídos y comprendidos | ✅ |
| Query actual identificada (línea `.limit(20)`) | ✅ |
| Patrón `searchParams` en Next.js 14 App Router verificado | ✅ |
| Patrón `serviceClient` + tipado `CallRow` identificado | ✅ |
| Ruta de nuevo archivo definida (`src/features/creator/components/`) | ✅ |
| Sin migraciones DB necesarias | ✅ |
| Sin dependencias nuevas | ✅ |
| Sin cambios en contratos Solidity | ✅ |
| Constraint Directives completas | ✅ |
| Exemplars con código real del codebase | ✅ |

**Veredicto:** ✅ LISTO PARA DEV — el Dev puede empezar desde el story file sin necesitar contexto adicional.

---

*Generado por Architect (San) — NexusAgil F2 — 2026-03-02*
