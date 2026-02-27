# Story UX-05 — Indicador de saldo de API key en navbar

**Estado:** READY FOR DEV  
**Fecha:** 2026-02-27  
**Sprint:** próximo  
**Estimado:** 3–4h  
**Autor SM:** San (BMAD SM)  
**Gate previo:** HU_APPROVED + SPEC_APPROVED de Fer ✅

---

## Descripción

Como consumer autenticado, quiero ver mi saldo de USDC disponible en la navbar para saber en todo momento si puedo invocar agentes, con señales visuales claras cuando el saldo esté bajo o agotado.

---

## Archivos a crear / modificar

### CREAR (3 archivos nuevos)

| Path | Tipo |
|------|------|
| `src/app/api/v1/me/key-balance/route.ts` | API Route Next.js |
| `src/features/layout/hooks/useApiKeyBalance.ts` | React Hook |
| `src/features/layout/components/ApiKeyBalance.tsx` | Componente React |

### MODIFICAR (2 archivos existentes)

| Path | Cambio |
|------|--------|
| `src/components/WasiNavBar.tsx` | Agregar `<ApiKeyBalance />` + strings i18n |
| `messages/en.json` | Agregar namespace `navbar` |
| `messages/es.json` | Agregar namespace `navbar` |

> **Nota estructura:** Si el directorio `src/features/layout/` no existe, créalo. El proyecto ya usa el patrón `src/features/` para organización por dominio.

---

## Criterios de Aceptación

### AC-01 — Renderizado del indicador
- [ ] El indicador aparece en la navbar desktop (≥640px) para cualquier usuario autenticado
- [ ] El indicador NO aparece para usuarios no autenticados (guests)
- [ ] Se ubica entre `<LanguageSwitcher />` y el bloque de email/signout existente
- [ ] NO se incluye en el menú mobile en este sprint (scope limitado — UX-07)

### AC-02 — Cálculo y display del saldo
- [ ] Muestra `remaining_usdc` (calculado server-side) con formato `$X.XX USDC`
- [ ] Siempre 2 decimales, símbolo `$`, texto literal `USDC`
- [ ] Dato obtenido de `GET /api/v1/me/key-balance` (endpoint nuevo, auth por sesión)
- [ ] Si saldo calculado es negativo, mostrar `$0.00` (tratar como agotado)

### AC-03 — Estados visuales (4 estados)
- [ ] **`ok` — Verde:** `usage_pct < 80%` → badge verde, ícono check, `$X.XX USDC`
- [ ] **`warning` — Amarillo:** `usage_pct >= 80%` (menos del 20% disponible) → badge amarillo, ícono triángulo, tooltip "Saldo bajo — recarga pronto"
- [ ] **`exhausted` — Rojo:** `remaining_usdc === 0` → badge rojo, ícono X, `$0.00 USDC`, tooltip "Saldo agotado — no puedes invocar agentes"
- [ ] **`no_key` — Gris:** usuario sin API key activa → badge gris, ícono llave, texto "Crear API key" (link a `/${locale}/agent-keys`)
- [ ] Estados adicionales de ciclo de vida: `loading` (skeleton), `error` (datos stale + ícono `!`), `inactive` (key desactivada)

### AC-04 — Polling y reactividad
- [ ] El saldo se refresca cada 60 segundos automáticamente
- [ ] El polling se **pausa** cuando `document.hidden === true` (pestaña oculta)
- [ ] Al volver al foco (`visibilitychange`), hace fetch inmediato para datos frescos
- [ ] Durante el fetch inicial, muestra skeleton de 64px (no spinner bloqueante)
- [ ] Re-fetches posteriores no bloquean la UI (datos stale visibles durante carga)

### AC-05 — Resiliencia
- [ ] Si el endpoint falla (5xx / timeout / red), muestra el **último valor conocido** con ícono `!` amarillo (estado `error`)
- [ ] Nunca muestra `$0.00` si hay datos previos disponibles — usar valor stale
- [ ] No hay `console.error` ni `console.warn` en producción al fallar el fetch

### AC-06 — Autenticación y ciclo de vida
- [ ] El hook NO ejecuta ningún fetch si `enabled = false`
- [ ] Si la sesión expira, el indicador desaparece sin errores en consola
- [ ] Al desmontar el componente, el interval se limpia y no hay memory leaks

### AC-07 — Accesibilidad
- [ ] `aria-label` descriptivo en todos los estados: `"Saldo disponible: $X.XX USDC"`, `"Sin API key activa"`, etc.
- [ ] Cada estado tiene **ícono + texto** (nunca solo color)
- [ ] Íconos llevan `aria-hidden="true"`

---

## Implementación completa

### 1. Endpoint `GET /api/v1/me/key-balance`

**Path:** `src/app/api/v1/me/key-balance/route.ts`

```typescript
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export interface KeyBalanceResponse {
  has_key: true
  name: string
  is_active: boolean
  budget_usdc: number
  spent_usdc: number
  remaining_usdc: number
  usage_pct: number
  status: 'ok' | 'low_budget' | 'budget_exhausted' | 'inactive'
  last_used_at: string | null
}

export interface NoKeyResponse {
  has_key: false
}

export type KeyBalanceResult = KeyBalanceResponse | NoKeyResponse

export async function GET() {
  const supabase = await createServerClient()

  // 1. Verificar sesión
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'not_authenticated' },
      { status: 401 }
    )
  }

  // 2. Obtener key activa del usuario
  const { data: key, error } = await supabase
    .from('agent_keys')
    .select('id, name, budget_usdc, spent_usdc, is_active, last_used_at')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  // Sin key activa o error de "no rows"
  if (error || !key) {
    return NextResponse.json({ has_key: false } satisfies NoKeyResponse)
  }

  // 3. Calcular campos derivados
  const budget = key.budget_usdc ?? 0
  const spent  = key.spent_usdc  ?? 0
  const remaining = Math.max(0, budget - spent)
  const usage_pct = budget > 0 ? Math.round((spent / budget) * 100) : 0

  // 4. Derivar status
  const status: KeyBalanceResponse['status'] =
    !key.is_active          ? 'inactive'
    : remaining === 0       ? 'budget_exhausted'
    : remaining < 0.5       ? 'low_budget'
    : 'ok'

  return NextResponse.json({
    has_key:        true,
    name:           key.name,
    is_active:      key.is_active,
    budget_usdc:    budget,
    spent_usdc:     spent,
    remaining_usdc: remaining,
    usage_pct,
    status,
    last_used_at:   key.last_used_at,
  } satisfies KeyBalanceResponse)
}
```

> **⚠️ Antes de implementar — verificar en Supabase:**
> 1. `agent_keys` tiene columna `user_id` (requerida para la query por sesión)
> 2. RLS policy `SELECT` por `auth.uid()` existe. Si no: `CREATE POLICY "users_read_own_keys" ON agent_keys FOR SELECT USING (user_id = auth.uid());`
> 3. Si `agent_keys` no tiene `user_id`, consultar con Fer antes de proceder

---

### 2. Hook `useApiKeyBalance`

**Path:** `src/features/layout/hooks/useApiKeyBalance.ts`

```typescript
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { KeyBalanceResult } from '@/app/api/v1/me/key-balance/route'

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type BalanceStatus =
  | 'loading'    // fetch inicial en curso → skeleton
  | 'no_key'     // usuario sin API key activa
  | 'ok'         // saldo suficiente (usage_pct < 80%)
  | 'warning'    // saldo bajo (usage_pct >= 80%, remaining > 0)
  | 'exhausted'  // saldo agotado (remaining_usdc === 0)
  | 'inactive'   // key existe pero is_active = false
  | 'error'      // fetch falló, mostrando datos stale

export interface UseApiKeyBalanceResult {
  /** Estado visual derivado para el componente */
  uiStatus: BalanceStatus
  /** Datos crudos del último fetch exitoso */
  data: KeyBalanceResult | null
  /** true solo durante el primer fetch */
  isInitialLoading: boolean
  /** true durante cualquier re-fetch (background) */
  isFetching: boolean
  /** true si el último fetch falló */
  hasError: boolean
  /** Fuerza re-fetch inmediato (usar tras invocar un agente) */
  refresh: () => void
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000
const ENDPOINT = '/api/v1/me/key-balance'

// ─── Derivación de uiStatus ───────────────────────────────────────────────────

function deriveUiStatus(
  data: KeyBalanceResult | null,
  hasError: boolean,
  isInitialLoading: boolean
): BalanceStatus {
  if (isInitialLoading) return 'loading'
  if (!data) return hasError ? 'error' : 'loading'

  if (!data.has_key) return 'no_key'

  const { status, remaining_usdc, usage_pct } = data

  if (status === 'inactive') return 'inactive'
  if (remaining_usdc === 0 || status === 'budget_exhausted') return 'exhausted'
  // warning = menos del 20% del budget disponible (usage_pct >= 80)
  if ((usage_pct ?? 0) >= 80) return 'warning'
  if (hasError) return 'error'  // datos stale presentes
  return 'ok'
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useApiKeyBalance(
  /** Activar el hook solo cuando hay sesión. Pasar `!!userEmail` desde WasiNavBar. */
  enabled: boolean
): UseApiKeyBalanceResult {
  const [data,             setData]             = useState<KeyBalanceResult | null>(null)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isFetching,       setIsFetching]       = useState(false)
  const [hasError,         setHasError]         = useState(false)

  // Ref para evitar setState en componentes desmontados
  const isMounted = useRef(true)
  // Ref para poder llamar fetchBalance dentro del callback de visibilitychange
  const fetchRef = useRef<() => Promise<void>>()

  const fetchBalance = useCallback(async () => {
    if (!isMounted.current || document.hidden) return
    setIsFetching(true)
    try {
      const res = await fetch(ENDPOINT, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: KeyBalanceResult = await res.json()
      if (isMounted.current) {
        setData(json)
        setHasError(false)
        setIsInitialLoading(false)
      }
    } catch {
      // No console.error en producción — el estado `error` maneja esto visualmente
      if (isMounted.current) {
        setHasError(true)
        setIsInitialLoading(false)
      }
    } finally {
      if (isMounted.current) setIsFetching(false)
    }
  }, [])

  // Mantener ref sincronizada para el listener de visibilidad
  fetchRef.current = fetchBalance

  useEffect(() => {
    if (!enabled) {
      setIsInitialLoading(false)
      return
    }

    isMounted.current = true

    // Fetch inicial
    fetchBalance()

    // Polling periódico (el guard `document.hidden` dentro de fetchBalance pausa naturalmente)
    const intervalId = setInterval(() => {
      fetchRef.current?.()
    }, POLL_INTERVAL_MS)

    // Reanudar fetch inmediato al volver el foco
    function handleVisibilityChange() {
      if (!document.hidden) {
        fetchRef.current?.()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      isMounted.current = false
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [enabled, fetchBalance])

  const uiStatus = deriveUiStatus(data, hasError, isInitialLoading)

  return {
    uiStatus,
    data,
    isInitialLoading,
    isFetching,
    hasError,
    refresh: fetchBalance,
  }
}
```

---

### 3. Componente `<ApiKeyBalance />`

**Path:** `src/features/layout/components/ApiKeyBalance.tsx`

> **⚠️ Íconos:** El proyecto **no tiene librería de íconos instalada** (no hay lucide-react, heroicons, etc. en package.json). Se usan SVGs inline, igual que en `WasiNavBar.tsx`. Los SVGs inline están incluidos abajo.

```typescript
'use client'

import Link from 'next/link'
import { useApiKeyBalance, type BalanceStatus } from '../hooks/useApiKeyBalance'

// ─── Props ────────────────────────────────────────────────────────────────────

interface ApiKeyBalanceProps {
  /** Pasar `!!userEmail` desde WasiNavBar — desactiva el hook sin sesión */
  enabled: boolean
  /** Locale actual extraído del pathname (e.g. 'en', 'es') */
  locale: string
}

// ─── SVG Íconos inline (sin dependencias externas) ───────────────────────────

function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

function IconTriangle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function IconXCircle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  )
}

function IconKey({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2l-9.6 9.6" />
      <path d="M15.5 7.5l3 3L22 7l-3-3" />
    </svg>
  )
}

function IconAlertCircle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

// ─── Helpers de formato ───────────────────────────────────────────────────────

function formatUSDC(amount: number): string {
  return `$${amount.toFixed(2)} USDC`
}

// ─── Mapa de estilos por estado ───────────────────────────────────────────────

const STATUS_STYLES: Record<BalanceStatus, string> = {
  loading:   'border-gray-200 bg-gray-50',
  no_key:    'border-gray-200 bg-gray-50',
  ok:        'border-green-200 bg-green-50',
  warning:   'border-yellow-200 bg-yellow-50',
  exhausted: 'border-red-200 bg-red-50',
  inactive:  'border-gray-200 bg-gray-50',
  error:     'border-yellow-200 bg-yellow-50',
}

const TEXT_STYLES: Record<BalanceStatus, string> = {
  loading:   'text-gray-400',
  no_key:    'text-gray-500',
  ok:        'text-green-700',
  warning:   'text-yellow-700',
  exhausted: 'text-red-700',
  inactive:  'text-gray-500',
  error:     'text-yellow-700',
}

const ICON_STYLES: Record<BalanceStatus, string> = {
  loading:   'text-gray-300',
  no_key:    'text-gray-400',
  ok:        'text-green-500',
  warning:   'text-yellow-500',
  exhausted: 'text-red-500',
  inactive:  'text-gray-400',
  error:     'text-yellow-500',
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function ApiKeyBalance({ enabled, locale }: ApiKeyBalanceProps) {
  const { uiStatus, data, isInitialLoading } = useApiKeyBalance(enabled)

  // No montar nada si no hay sesión
  if (!enabled) return null

  // ── Estado: fetch inicial → skeleton ──────────────────────────────────────
  if (isInitialLoading) {
    return (
      <div
        className="h-7 w-20 animate-pulse rounded-full bg-gray-100"
        aria-label="Cargando saldo..."
        role="status"
      />
    )
  }

  const badgeBase = `flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[uiStatus]}`
  const textClass = TEXT_STYLES[uiStatus]
  const iconClass = `h-3.5 w-3.5 shrink-0 ${ICON_STYLES[uiStatus]}`

  // ── Estado: sin key activa ─────────────────────────────────────────────────
  if (uiStatus === 'no_key') {
    return (
      <Link
        href={`/${locale}/agent-keys`}
        className={`${badgeBase} hover:bg-gray-100 transition-colors`}
        aria-label="Sin API key activa — Crear API key"
        title="Crea tu API key para invocar agentes"
      >
        <IconKey className={iconClass} />
        <span className={textClass}>Crear API key</span>
      </Link>
    )
  }

  // ── Extraer saldo para estados con datos ───────────────────────────────────
  const remaining = data && data.has_key ? data.remaining_usdc : 0
  const displayAmount = formatUSDC(remaining ?? 0)

  // ── Tooltip por estado ─────────────────────────────────────────────────────
  const tooltips: Partial<Record<BalanceStatus, string>> = {
    ok:        `Saldo disponible: ${displayAmount}`,
    warning:   'Saldo bajo — recarga pronto',
    exhausted: 'Saldo agotado — no puedes invocar agentes',
    inactive:  'Tu API key está desactivada',
    error:     'No se pudo actualizar el saldo',
  }
  const tooltip = tooltips[uiStatus] ?? displayAmount

  // ── Badge con ícono según estado ───────────────────────────────────────────
  function renderIcon() {
    switch (uiStatus) {
      case 'ok':       return <IconCheck className={iconClass} />
      case 'warning':  return <IconTriangle className={iconClass} />
      case 'exhausted':return <IconXCircle className={iconClass} />
      case 'inactive': return <IconKey className={iconClass} />
      case 'error':    return <IconAlertCircle className={iconClass} />
      default:         return <IconKey className={iconClass} />
    }
  }

  // ── aria-label descriptivo ─────────────────────────────────────────────────
  function ariaLabel() {
    switch (uiStatus) {
      case 'ok':
      case 'warning':
      case 'exhausted': return `Saldo disponible: ${displayAmount}`
      case 'inactive':  return 'API key inactiva'
      case 'error':     return `Saldo (no actualizado): ${displayAmount}`
      default:          return 'Saldo de API key'
    }
  }

  return (
    <div
      className={badgeBase}
      aria-label={ariaLabel()}
      title={tooltip}
      role="status"
    >
      {renderIcon()}
      <span className={textClass}>
        {uiStatus === 'inactive' ? 'Key inactiva' : displayAmount}
      </span>
      {/* Indicador adicional de datos stale en estado error */}
      {uiStatus === 'error' && (
        <span className="ml-0.5 text-yellow-400 text-xs" aria-hidden="true">!</span>
      )}
    </div>
  )
}
```

---

### 4. Modificar `WasiNavBar.tsx`

**Path:** `src/components/WasiNavBar.tsx`

#### 4a. Agregar import (al inicio del archivo, junto a los imports existentes)

```typescript
import { ApiKeyBalance } from '@/features/layout/components/ApiKeyBalance'
```

#### 4b. Insertar `<ApiKeyBalance />` en el desktop nav

Ubicar el bloque exacto en `WasiNavBar.tsx`:

```tsx
          {/* Language switcher — desktop */}
          <div className="hidden sm:flex shrink-0">
            <LanguageSwitcher />
          </div>

          {/* Auth actions */}
          <div className="hidden items-center gap-3 sm:flex shrink-0">
```

Reemplazarlo por:

```tsx
          {/* Language switcher — desktop */}
          <div className="hidden sm:flex shrink-0">
            <LanguageSwitcher />
          </div>

          {/* API Key Balance — solo si hay sesión (desktop) */}
          {userEmail && (
            <div className="hidden sm:flex shrink-0">
              <ApiKeyBalance enabled={!!userEmail} locale={locale} />
            </div>
          )}

          {/* Auth actions */}
          <div className="hidden items-center gap-3 sm:flex shrink-0">
```

> **Nota:** No se añaden props nuevas a `WasiNavBar`. El `locale` ya existe como variable local (extraído del pathname). El `userEmail` ya existe como estado local. No se modifica la lógica de auth.

---

### 5. Agregar strings i18n

#### `messages/en.json` — agregar el namespace `navbar` al objeto raíz:

```json
"navbar": {
  "balance": {
    "loading":        "Loading balance...",
    "noKey":          "Create API key",
    "noKeyTooltip":   "Create your API key to invoke agents",
    "ok":             "Balance: {amount}",
    "warning":        "Low balance — top up soon",
    "exhausted":      "Balance exhausted — cannot invoke agents",
    "inactive":       "Key inactive",
    "inactiveTooltip":"Your API key is deactivated",
    "error":          "Balance unavailable",
    "staleTooltip":   "Could not update balance"
  }
}
```

#### `messages/es.json` — agregar el namespace `navbar` al objeto raíz:

```json
"navbar": {
  "balance": {
    "loading":        "Cargando saldo...",
    "noKey":          "Crear API key",
    "noKeyTooltip":   "Crea tu API key para invocar agentes",
    "ok":             "Saldo: {amount}",
    "warning":        "Saldo bajo — recarga pronto",
    "exhausted":      "Saldo agotado — no puedes invocar agentes",
    "inactive":       "Key inactiva",
    "inactiveTooltip":"Tu API key está desactivada",
    "error":          "Saldo no disponible",
    "staleTooltip":   "No se pudo actualizar el saldo"
  }
}
```

> **Nota MVP:** El componente `ApiKeyBalance.tsx` tiene los strings hardcodeados en español por simplicidad. Si el proyecto requiere i18n completa en este componente, usar `useTranslations('navbar.balance')` desde `next-intl` y reemplazar los string literals con las claves del namespace arriba definido. Para el MVP está bien hardcodeado.

---

## Checklist de verificación previa (Dev: ejecutar antes de escribir código)

```bash
# 1. Verificar que agent_keys tiene user_id
npx supabase db query "SELECT column_name FROM information_schema.columns WHERE table_name='agent_keys' AND column_name='user_id';"

# 2. Verificar RLS policies en agent_keys
npx supabase db query "SELECT policyname, cmd FROM pg_policies WHERE tablename='agent_keys';"

# 3. Confirmar que no hay icon lib instalada (sin surpresas)
cat package.json | grep -E "lucide|heroicons|radix"

# 4. Confirmar estructura de directorios
ls src/features/ 2>/dev/null || echo "Crear src/features/layout/hooks/ y src/features/layout/components/"
```

Si la columna `user_id` no existe en `agent_keys` → **STOP, notificar a Fer antes de continuar**.

---

## Casos edge documentados

| Caso | Comportamiento esperado |
|------|------------------------|
| Usuario con múltiples keys activas | Mostrar la primera (ORDER BY created_at DESC LIMIT 1) — deuda técnica documentada para UX-08 |
| Saldo negativo en DB (`spent > budget`) | Mostrar `$0.00` — `Math.max(0, budget - spent)` en el endpoint |
| `budget_usdc = 0` | `usage_pct = 0`, status `ok` (no divide por cero), `remaining = 0` → estado `exhausted` |
| Endpoint tarda > 5s | Skeleton visible, sin timeout hard — respuesta llega eventualmente |
| Sesión expira mientras polling activo | El próximo fetch recibe 401, `setHasError(true)`, muestra datos stale. Al desmontar el componente (redirect a login), el cleanup del useEffect limpia el interval |
| Fetch inicial con pestaña en background | `document.hidden = true` → el fetch hace early return → se reintenta al volver al foco |
| Network offline | Catch del fetch → estado `error`, datos stale visibles con ícono `!` |

---

## Revisión adversarial (checklist para Dev antes de PR)

- [ ] ¿El endpoint responde 401 si llamas sin sesión? (`curl /api/v1/me/key-balance` sin cookie)
- [ ] ¿El interval se limpia al desmontar? (React DevTools → unmount el componente → no hay fetch en background)
- [ ] ¿Hay algún `any` explícito en el código? (TypeScript strict: prohibido)
- [ ] ¿El badge rompe el layout si el nombre es muy largo? (el texto es fijo: `$X.XX USDC`)
- [ ] ¿El skeleton aparece en el primer render antes del fetch? (no flash de estado vacío)
- [ ] ¿El estado `error` muestra datos stale y no `$0.00`? (probar con network offline tras primer fetch)
- [ ] ¿El link de `no_key` va a `/${locale}/agent-keys` (con locale correcto)?
- [ ] ¿El componente tiene `'use client'` en la primera línea?
- [ ] ¿El endpoint usa `createServerClient()` (no `createClient()` del browser)?
- [ ] ¿RLS policy existe en `agent_keys` antes del merge?

---

## Definition of Done (DoD)

### Funcional
- [ ] `GET /api/v1/me/key-balance` → 200 con datos correctos (sesión activa)
- [ ] `GET /api/v1/me/key-balance` → 401 sin sesión
- [ ] `GET /api/v1/me/key-balance` → `{ has_key: false }` sin keys activas
- [ ] Hook inicia polling al montar, lo detiene al desmontar (no memory leaks)
- [ ] Polling se pausa con pestaña oculta, fetch inmediato al volver al foco
- [ ] Skeleton visible durante fetch inicial (sin flash de estado vacío)
- [ ] Los 4 estados principales renderizan: `ok`, `warning`, `exhausted`, `no_key`
- [ ] Estado `error` muestra último valor conocido (no `$0.00` si hay datos previos)
- [ ] El indicador NO se monta si `userEmail` es `null`

### UI / UX
- [ ] Indicador visible en desktop nav (≥640px), entre LanguageSwitcher y email/signout
- [ ] Cada estado tiene ícono SVG + texto (no solo color)
- [ ] `aria-label` descriptivo en cada estado
- [ ] Estado `no_key` linkea a `/${locale}/agent-keys`
- [ ] Formato `$X.XX USDC` con 2 decimales en todos los estados numéricos

### Calidad
- [ ] TypeScript strict — zero `any` explícito
- [ ] Zero `console.error` / `console.warn` en producción
- [ ] RLS policy verificada en `agent_keys` antes del merge
- [ ] Revisión adversarial completada (checklist arriba)
- [ ] Code review formal aprobado por Fer antes de commit

---

## Árbol de dependencias

```
WasiNavBar.tsx
  └── ApiKeyBalance.tsx (presentacional, 'use client')
        └── useApiKeyBalance.ts (hook, 'use client')
              └── GET /api/v1/me/key-balance (API Route, server)
                    └── agent_keys tabla (Supabase, solo SELECT)
```

---

## Notas de arquitectura

- **Sin SWR/React Query** — el proyecto no los tiene instalados. Polling manual con `setInterval` + `useEffect` es correcto y suficiente para 60s de intervalo.
- **`cache: 'no-store'`** en el `fetch()` — evita que Next.js cachee la respuesta en el router cache del cliente.
- **`'use client'`** es obligatorio en `ApiKeyBalance.tsx` y `useApiKeyBalance.ts` — usan hooks y APIs del browser.
- **El hook exporta `refresh()`** para que otros componentes (e.g. invoke flow en UX-07) puedan forzar actualización post-invocación sin acoplamiento interno.
- **Datos stale nunca = `$0.00`** — si hay datos previos disponibles, siempre mostrarlos con indicador de error en vez de confundir al usuario con saldo cero falso.
- **No incluir en mobile menu** en este sprint — scope limitado. Se añadirá en UX-07 junto con el botón de recarga inline.

---

*Story generada por SM San — BMAD Method v6 | 2026-02-27*  
*Próximo gate: Dev → implementar desde este story file | Code Review → Fer aprueba antes de commit*
