# Story File — WAS-115: Paginación Recent Calls

**ID:** WAS-115  
**F2.5 generado:** 2026-03-02  
**Autor:** Architect (San) — NexusAgil  
**Status:** READY FOR DEV  

---

## 1. Goal

El dashboard del creator actualmente trae hasta 20 invocaciones con `.limit(20)` sin paginación. Se requiere mostrar exactamente **10 por página** con controles Anterior/Siguiente, paginando en la DB (no en memoria). El objetivo es evitar traer datos innecesarios y que el creator pueda navegar todo su historial de calls.

---

## 2. Acceptance Criteria (EARS)

| # | Criterio | Verificación |
|---|----------|-------------|
| AC-1 | WHEN el creator abre el dashboard, THEN Recent Calls muestra exactamente 10 registros (o menos si hay < 10) | `CALLS_PER_PAGE = 10`, query con `.range(offset, offset+9)` |
| AC-2 | WHEN hay más de 10 calls totales, THEN se muestran controles Anterior / Siguiente con número de página actual | `totalPages > 1` → render `<CallsPagination>` |
| AC-3 | WHEN hay 10 o menos calls totales, THEN los controles de paginación NO aparecen | `totalPages <= 1` → `CallsPagination` retorna `null` |
| AC-4 | WHEN el creator navega de página, THEN la URL refleja `?callsPage=N` y persiste al recargar | `router.push()` con `params.set('callsPage', ...)` |
| AC-5 | WHEN se hace la query a Supabase, THEN usa `.range()` con `{ count: 'exact' }` — sin `.limit()` ni full scan | Verificado en code review |
| AC-6 | WHEN se visualiza en mobile, THEN los botones son accesibles y no se truncan | Tailwind responsive, min touch target 40px |

---

## 3. Files to Modify / Create

| Path | Acción | Exemplar |
|------|--------|---------|
| `src/app/[locale]/creator/dashboard/page.tsx` | MODIFICAR | Ver §4.A |
| `src/features/creator/components/CallsPagination.tsx` | CREAR (nuevo archivo) | Ver §4.B |

---

## 4. Exemplars

### 4.A — Cambios en `page.tsx`

**Estado actual del archivo** (extraído literalmente):

```ts
// Línea ~1 — imports existentes (NO modificar ninguno de estos)
import React, { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { EarningsSection, EarningsSkeleton } from './_components/EarningsSection'
import { AgentActions } from './_components/AgentActions'
import { FreeTrialToggle } from './_components/FreeTrialToggle'
import { PendingEarningsBanner } from '@/components/PendingEarningsBanner'
import { CreatorAnalytics } from '@/features/creator/components/CreatorAnalytics'
```

**Interfaces existentes** (ya están en el archivo, NO duplicar):

```ts
interface CallRow {
  id: string
  agent_id: string
  caller_type: string
  amount_paid: number
  status: string
  latency_ms: number | null
  called_at: string
  agent: { name: string; slug: string } | null
}
```

**Firma actual del componente** (línea ~42):

```ts
export default async function CreatorDashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
```

**Lo que hay que cambiar:**

#### Paso 1 — Añadir import de `CallsPagination` (al final de los imports existentes)

```ts
import { CallsPagination } from '@/features/creator/components/CallsPagination'
```

#### Paso 2 — Añadir constante antes del componente (justo antes de `export default async function`)

```ts
const CALLS_PER_PAGE = 10
```

#### Paso 3 — Cambiar la firma del componente para recibir `searchParams`

ANTES:
```ts
export default async function CreatorDashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
```

DESPUÉS:
```ts
export default async function CreatorDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ callsPage?: string }>
}) {
  const { locale } = await params
  const { callsPage: callsPageParam } = await searchParams
```

#### Paso 4 — Añadir cálculo de paginación (justo antes de la query `recentCallsData`)

Insertar estas líneas antes del bloque `const serviceClient = createServiceClient()`:

```ts
  const callsPage = Math.max(1, parseInt(callsPageParam ?? '1', 10))
  const callsOffset = (callsPage - 1) * CALLS_PER_PAGE
```

#### Paso 5 — Reemplazar la query de `recentCallsData`

ANTES (query actual, líneas ~63-70):
```ts
  const recentCallsData = modelIds.length > 0
    ? await serviceClient
        .from('agent_calls')
        .select('id, agent_id, caller_type, amount_paid, status, latency_ms, called_at, agent:agents(name, slug)')
        .in('agent_id', modelIds)
        .order('called_at', { ascending: false })
        .limit(20)
    : { data: [] }

  const recentCalls: CallRow[] = (recentCallsData.data as unknown as CallRow[]) ?? []
```

DESPUÉS:
```ts
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

#### Paso 6 — Actualizar la sección "Recent calls" en el JSX

Buscar la sección `{/* Recent calls */}` en el return. El bloque actual es:

```tsx
        {/* Recent calls */}
        <section>
          <h2 className="mb-4 font-semibold text-gray-900">{t('recentCalls')}</h2>

          {recentCalls.length === 0 ? (
            <EmptyState
              icon="⚡"
              title={t('noCalls')}
              subtitle={t('noCallsSubtitle')}
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
              {/* WAS-55: min-w fuerza overflow real en mobile */}
              <table className="w-full min-w-[560px] text-sm">
                {/* ... thead y tbody sin cambios ... */}
              </table>
            </div>
          )}
        </section>
```

Cambiar la condición del EmptyState y envolver el contenido en un fragment con `<CallsPagination>`:

```tsx
        {/* Recent calls */}
        <section>
          <h2 className="mb-4 font-semibold text-gray-900">{t('recentCalls')}</h2>

          {recentCalls.length === 0 && callsPage === 1 ? (
            <EmptyState
              icon="⚡"
              title={t('noCalls')}
              subtitle={t('noCallsSubtitle')}
            />
          ) : (
            <>
              <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
                {/* WAS-55: min-w fuerza overflow real en mobile */}
                <table className="w-full min-w-[560px] text-sm">
                  {/* thead y tbody: NO MODIFICAR — copiar exactamente como están */}
                </table>
              </div>
              <CallsPagination currentPage={callsPage} totalPages={totalPages} />
            </>
          )}
        </section>
```

> ⚠️ El thead y tbody de la tabla de calls NO se modifican. Solo cambia el wrapper exterior y se agrega `<CallsPagination>` después del `</div>`.

---

### 4.B — Nuevo archivo `CallsPagination.tsx`

Crear exactamente este archivo en `src/features/creator/components/CallsPagination.tsx`:

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

## 5. Constraint Directives

### OBLIGATORIO ✅
- `CALLS_PER_PAGE = 10` — constante definida **una sola vez**, fuera del componente, antes del `export default`
- La query DEBE usar `.range(callsOffset, callsOffset + CALLS_PER_PAGE - 1)` con `{ count: 'exact' }` como segundo arg de `.select()`
- `searchParams` en App Router Next.js 14 llega como `Promise<{...}>` — DEBE awaitearse con `const { callsPage: callsPageParam } = await searchParams`
- `CallsPagination` DEBE tener `'use client'` como primera línea (usa hooks de React/Next.js)
- Validar `callsPage` con `Math.max(1, parseInt(callsPageParam ?? '1', 10))` — protección contra valores inválidos o NaN
- `npm run build` sin errores TypeScript ni warnings ESLint antes de reportar DONE
- El thead/tbody de la tabla de calls se copia **sin ningún cambio**

### PROHIBIDO ❌
- ❌ NO usar `.limit()` en la query paginada (fue reemplazado por `.range()`)
- ❌ NO usar `any` explícito — mantener tipado `CallRow[]` ya existente
- ❌ NO traer todos los registros para paginar en memoria (el `.range()` pagina en DB)
- ❌ NO usar CSS modules ni styled-components — solo Tailwind
- ❌ NO agregar dependencias nuevas (`npm install` no es necesario)
- ❌ NO modificar el render interno de la tabla (thead, tbody, tr, td) — solo el wrapper exterior
- ❌ NO duplicar la interfaz `CallRow` — ya existe en `page.tsx`
- ❌ NO usar `useSearchParams` en `page.tsx` — es Server Component, usa el prop `searchParams`

---

## 6. Waves

### W0 — Serial (ejecutar en orden estricto)

#### W0.1 — Crear `CallsPagination.tsx`

1. Crear archivo `src/features/creator/components/CallsPagination.tsx`
2. Copiar **exactamente** el código del §4.B
3. Verificar que comienza con `'use client'`

#### W0.2 — Modificar `page.tsx`

Aplicar todos los cambios del §4.A en orden:

1. Añadir import de `CallsPagination` al final del bloque de imports
2. Añadir constante `CALLS_PER_PAGE = 10` antes del `export default`
3. Cambiar firma del componente para incluir `searchParams: Promise<{ callsPage?: string }>`
4. Awaitar `searchParams` y calcular `callsPage` y `callsOffset`
5. Reemplazar la query de `recentCallsData` con la versión paginada (`.range()` + `count: 'exact'`)
6. Añadir cálculo de `totalCallsCount` y `totalPages` después de la query
7. Actualizar la sección JSX de Recent Calls:
   - Cambiar condición del EmptyState a `recentCalls.length === 0 && callsPage === 1`
   - Envolver tabla en fragment `<>...</>`
   - Agregar `<CallsPagination currentPage={callsPage} totalPages={totalPages} />` después del div de la tabla

#### W0.3 — Build check

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2
npm run build
```

Debe terminar con **0 errores, 0 type errors**. Si hay errores, corregirlos antes de continuar.

---

## 7. Out of Scope

- ❌ No modificar la tabla de agents (solo la de recent calls)
- ❌ No añadir paginación a otras secciones del dashboard
- ❌ No cambiar el esquema de la DB (sin migraciones)
- ❌ No modificar `EarningsSection`, `AgentActions`, `FreeTrialToggle`, `CreatorAnalytics`
- ❌ No cambiar el diseño visual de la tabla de calls
- ❌ No agregar filtros, búsqueda, ni ordenamiento
- ❌ No agregar claves de i18n nuevas (los textos "Anterior"/"Siguiente" van inline)
- ❌ No tocar contratos Solidity ni APIs de blockchain

---

## 8. Escalation Rule

**Si algo no está explícitamente descrito en este story file → DEV PARA y pregunta al Architect.**

No improvisar. No asumir. No leer el SDD directamente.

Casos concretos que requieren escalación:
- Si el archivo `src/features/creator/components/` no existe como directorio
- Si hay un error de TypeScript que no se puede resolver sin cambiar la interfaz `CallRow`
- Si el build falla por un motivo no relacionado con los cambios de esta HU
- Si hay conflicto con código que no aparece en los exemplars de este documento

---

*Story File generado por Architect (San) — NexusAgil F2.5 — WAS-115 — 2026-03-02*
