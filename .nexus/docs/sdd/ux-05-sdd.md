# UX-05 — S1: SDD (Software Design Document)
## Indicador de saldo de API key en navbar

**Estado:** DRAFT — pendiente SPEC_APPROVED de Fer  
**Fecha:** 2026-02-27  
**Autor:** San (PM/Architect BMAD)  
**HU referencia:** UX-05 S0 (`ux-05-s0.md`)  
**Gate:** S1 → requiere SPEC_APPROVED explícito antes de pasar a SM/Story

---

## ⚠️ Hallazgo crítico: endpoint existente no es compatible

El endpoint `GET /api/v1/agent-keys/me` autentica vía `x-agent-key` header (hash SHA-256 de la raw key). **No usa sesión Supabase**. Fue diseñado para que agentes autónomos hagan self-check, no para el browser del usuario.

**Consecuencia:** necesitamos un endpoint nuevo `GET /api/v1/me/key-balance` que:
- Autentica vía sesión Supabase (cookie/token del browser)
- Consulta la key activa (`is_active = true`) del usuario autenticado
- Devuelve el mismo shape de datos que el endpoint existente

Esto NO es un bloqueante — es una nueva ruta simple en Next.js API. Está dentro del scope de UX-05.

---

## 1. Archivos a crear o modificar

### Crear (nuevos)

| Path | Tipo | Descripción |
|------|------|-------------|
| `src/app/api/v1/me/key-balance/route.ts` | API Route | Endpoint autenticado por sesión para obtener saldo de la key activa |
| `src/features/layout/hooks/useApiKeyBalance.ts` | Hook | Polling + visibilitychange + estados derivados |
| `src/features/layout/components/ApiKeyBalance.tsx` | Component | Indicador visual (badge + tooltip) |

### Modificar (existentes)

| Path | Cambio |
|------|--------|
| `src/components/WasiNavBar.tsx` | Importar y renderizar `<ApiKeyBalance />` en la sección "Auth actions" del desktop nav, antes del email/signout |

---

## 2. Endpoint nuevo: `GET /api/v1/me/key-balance`

### Autenticación
Sesión Supabase via `createClient()` server-side (cookie del browser). Sin `x-agent-key`.

### Lógica
```
1. Obtener user de sesión → si no hay sesión → 401
2. SELECT id, name, budget_usdc, spent_usdc, is_active, last_used_at
   FROM agent_keys
   WHERE user_id = auth.uid()
   AND is_active = true
   ORDER BY created_at DESC
   LIMIT 1
3. Si no hay rows → { has_key: false }
4. Calcular remaining = max(0, budget - spent)
5. Calcular usage_pct = budget > 0 ? round((spent/budget)*100) : 0
6. Retornar shape (ver abajo)
```

### Response shape

```typescript
// 200 — con key activa
{
  has_key: true,
  name: string,
  is_active: boolean,
  budget_usdc: number,
  spent_usdc: number,
  remaining_usdc: number,   // max(0, budget - spent)
  usage_pct: number,        // 0-100
  status: 'ok' | 'low_budget' | 'budget_exhausted' | 'inactive',
  last_used_at: string | null,
}

// 200 — sin key activa
{
  has_key: false,
}

// 401 — no autenticado
{
  error: 'Unauthorized',
  code: 'not_authenticated',
}
```

### Status derivation (idéntica al endpoint existente)
```typescript
status = !is_active        ? 'inactive'
       : remaining === 0   ? 'budget_exhausted'
       : remaining < 0.5   ? 'low_budget'   // threshold: $0.50 USDC
       : 'ok'
```

> **Nota:** el threshold de `low_budget` en el endpoint original es `< 0.5`. Para los estados visuales del AC-03 del PRD (warning = < 20% del budget), usamos `usage_pct` que ya viene calculado. El `status` del endpoint es orientativo; la lógica de color la calcula el hook.

---

## 3. Interface TypeScript del hook `useApiKeyBalance`

```typescript
// src/features/layout/hooks/useApiKeyBalance.ts

export type BalanceStatus =
  | 'loading'       // fetch inicial en curso, mostramos skeleton
  | 'no_key'        // usuario no tiene API key activa
  | 'ok'            // saldo suficiente (usage_pct < 80%)
  | 'warning'       // saldo bajo (usage_pct entre 80% y 99%)
  | 'exhausted'     // saldo agotado (remaining_usdc === 0 o usage_pct = 100)
  | 'inactive'      // key existe pero is_active = false
  | 'error'         // fetch falló, mostrando último valor conocido

export interface ApiKeyBalanceData {
  has_key: boolean
  name?: string
  remaining_usdc?: number
  usage_pct?: number
  budget_usdc?: number
  status?: 'ok' | 'low_budget' | 'budget_exhausted' | 'inactive'
}

export interface UseApiKeyBalanceResult {
  /** Estado visual derivado para el componente */
  uiStatus: BalanceStatus
  /** Datos crudos del último fetch exitoso */
  data: ApiKeyBalanceData | null
  /** true durante el fetch inicial solamente */
  isInitialLoading: boolean
  /** true durante cualquier re-fetch (no bloquea UI) */
  isFetching: boolean
  /** true si el último fetch falló (muestra datos stale) */
  hasError: boolean
  /** Fuerza un re-fetch inmediato (para llamar tras invocar agente) */
  refresh: () => void
}

export function useApiKeyBalance(
  /** Solo activa el hook si hay sesión. Pasar `!!userEmail` desde WasiNavBar. */
  enabled: boolean
): UseApiKeyBalanceResult
```

---

## 4. Lógica de polling (60s + visibilitychange)

```typescript
// Pseudocódigo del hook — implementación completa en la story

const POLL_INTERVAL_MS = 60_000

useEffect(() => {
  if (!enabled) return

  let intervalId: ReturnType<typeof setInterval> | null = null
  let isMounted = true

  async function fetchBalance() {
    if (!isMounted || document.hidden) return
    setIsFetching(true)
    try {
      const res = await fetch('/api/v1/me/key-balance', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (isMounted) {
        setData(json)
        setHasError(false)
        setIsInitialLoading(false)
      }
    } catch {
      if (isMounted) {
        setHasError(true)
        setIsInitialLoading(false)
      }
    } finally {
      if (isMounted) setIsFetching(false)
    }
  }

  // Fetch inicial
  fetchBalance()

  // Polling periódico
  intervalId = setInterval(fetchBalance, POLL_INTERVAL_MS)

  // Pausa/reanuda según visibilidad de la pestaña
  function handleVisibilityChange() {
    if (document.hidden) {
      // Pausa: el interval sigue corriendo pero fetchBalance() hace early return
      // (alternativa más limpia: clear + restart, aquí usamos el guard document.hidden)
    } else {
      // Al volver al foco: fetch inmediato para datos frescos
      fetchBalance()
    }
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)

  return () => {
    isMounted = false
    if (intervalId) clearInterval(intervalId)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }
}, [enabled])

// refresh() expuesto para llamar externamente tras invocar agente
const refresh = useCallback(() => { fetchBalance() }, [])
```

### Derivación de `uiStatus` desde `data`

```typescript
function deriveUiStatus(data: ApiKeyBalanceData | null, hasError: boolean, isInitialLoading: boolean): BalanceStatus {
  if (isInitialLoading) return 'loading'
  if (!data) return hasError ? 'error' : 'loading'
  if (!data.has_key) return 'no_key'
  if (data.status === 'inactive') return 'inactive'
  if (data.remaining_usdc === 0 || data.status === 'budget_exhausted') return 'exhausted'
  // warning = usage_pct >= 80 (o sea, menos del 20% del budget disponible — AC-03)
  if ((data.usage_pct ?? 0) >= 80) return 'warning'
  if (hasError) return 'error'  // datos stale pero presentes
  return 'ok'
}
```

---

## 5. Estados visuales del componente `<ApiKeyBalance />`

El componente es puramente presentacional — recibe `uiStatus`, `data`, y `locale` como props.

### Mapa de estados

| `uiStatus` | Color badge | Ícono | Texto principal | Tooltip |
|------------|-------------|-------|-----------------|---------|
| `loading` | Gris | — | Skeleton 64px wide | — |
| `no_key` | Gris neutro `gray-400` | `KeyIcon` (outline) | "Crear API key" (link) | "Crea tu API key para invocar agentes" |
| `ok` | Verde `green-500` | `CircleCheckIcon` | `$X.XX USDC` | `"Saldo disponible: $X.XX USDC"` |
| `warning` | Amarillo `yellow-500` | `TriangleAlertIcon` | `$X.XX USDC` | `"Saldo bajo — recarga pronto"` |
| `exhausted` | Rojo `red-500` | `CircleXIcon` | `$0.00 USDC` | `"Saldo agotado — no puedes invocar agentes"` |
| `inactive` | Gris `gray-400` | `KeyIcon` (slash) | "Key inactiva" | `"Tu API key está desactivada"` |
| `error` | Gris con `!` amarillo | `AlertCircleIcon` | último valor conocido | `"No se pudo actualizar el saldo"` |

### Reglas de presentación

- **Solo color no es suficiente** (AC-07): cada estado tiene ícono + texto, no solo color
- **`aria-label`** siempre descriptivo: `"Saldo disponible: $X.XX USDC"` o `"Sin API key activa"`
- **Formato numérico:** `$X.XX USDC` — siempre 2 decimales, símbolo dólar, texto "USDC"
- **`no_key`**: el texto "Crear API key" es un `<Link href={/${locale}/agent-keys}>` con estilo acorde
- **Skeleton:** `<div className="h-5 w-16 animate-pulse rounded bg-gray-100" />` — no spinner bloqueante
- **Tooltip:** implementado con `title` HTML por defecto (suficiente para MVP); actualizable a Radix Tooltip en UX-06+

### Ejemplo JSX del badge (estado `ok`)

```tsx
<div
  className="flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-1"
  aria-label={`Saldo disponible: $${remaining.toFixed(2)} USDC`}
  title="Saldo suficiente"
>
  <CircleCheckIcon className="h-3.5 w-3.5 text-green-500" aria-hidden />
  <span className="text-xs font-semibold text-green-700">
    ${remaining.toFixed(2)} USDC
  </span>
</div>
```

---

## 6. Integración en `WasiNavBar.tsx`

### Punto de inserción exacto

En la sección "Auth actions" del desktop nav, **entre el LanguageSwitcher y el bloque de email/signout**:

```tsx
{/* Language switcher — desktop */}
<div className="hidden sm:flex shrink-0">
  <LanguageSwitcher />
</div>

{/* ← INSERTAR AQUÍ: ApiKeyBalance (solo si hay sesión) */}
<div className="hidden sm:flex shrink-0">
  {userEmail && (
    <ApiKeyBalance
      enabled={!!userEmail}
      locale={locale}
    />
  )}
</div>

{/* Auth actions */}
<div className="hidden items-center gap-3 sm:flex shrink-0">
  {loading ? (
    ...
```

### Cambios en el componente

1. **Import:** `import { ApiKeyBalance } from '@/features/layout/components/ApiKeyBalance'`
2. **No se añaden nuevos estados al componente padre** — `ApiKeyBalance` es autocontenido (usa `useApiKeyBalance` internamente)
3. **Prop `enabled`:** pasa `!!userEmail` para que el hook no ejecute fetch si no hay sesión
4. **Prop `locale`:** necesaria para el link `/${locale}/agent-keys` en estado `no_key`
5. **Mobile menu:** NO incluir en mobile en UX-05 (scope limitado). Se puede añadir en UX-07 junto con el botón de recarga.

---

## 7. Definition of Done (DoD)

### Funcional
- [ ] `GET /api/v1/me/key-balance` responde correctamente con sesión activa (200 con datos)
- [ ] `GET /api/v1/me/key-balance` responde 401 sin sesión
- [ ] `GET /api/v1/me/key-balance` responde `{ has_key: false }` si el usuario no tiene keys activas
- [ ] El hook inicia el polling al montar y lo detiene al desmontar
- [ ] El polling se pausa cuando la pestaña está oculta y hace fetch inmediato al volver al foco
- [ ] El componente muestra skeleton durante el fetch inicial (no flash de estado vacío)
- [ ] Los 4 estados visuales renderizan correctamente (ok / warning / exhausted / no_key)
- [ ] Estado `error` muestra el último valor conocido (datos stale), no pantalla en blanco
- [ ] El indicador NO se monta si `userEmail` es null (no hay sesión)

### UI / UX
- [ ] El indicador aparece en desktop nav antes del email/signout (visible en viewport 640px+)
- [ ] Cada estado tiene ícono + texto (no solo color) — requisito a11y
- [ ] `aria-label` descriptivo en todos los estados
- [ ] El estado `no_key` linkea a `/[locale]/agent-keys`
- [ ] Formato `$X.XX USDC` con 2 decimales en todos los estados con valor numérico

### Calidad
- [ ] TypeScript strict — sin `any`
- [ ] No hay `console.error` / `console.warn` en producción al fallar el fetch
- [ ] El componente no rompe el layout si la respuesta del endpoint demora > 5s
- [ ] Revisión adversarial completada (ver checklist en story)
- [ ] Code review formal aprobado por Fer antes de commit

---

## 8. Implementation Readiness Check

| # | Check | Estado | Notas |
|---|-------|--------|-------|
| IR-01 | Endpoint `GET /api/v1/agent-keys/me` shape verificado | ✅ | Devuelve `budget_usdc`, `spent_usdc`, `remaining_usdc`, `usage_pct`, `status`, `is_active` — todos los campos necesarios |
| IR-02 | Endpoint existente es compatible con navbar | ❌ | **Bloqueante mitigado:** autentica por `x-agent-key`, no por sesión. Requiere endpoint nuevo `GET /api/v1/me/key-balance` (incluido en scope) |
| IR-03 | WasiNavBar.tsx localizado y analizado | ✅ | `src/components/WasiNavBar.tsx` — punto de inserción identificado |
| IR-04 | Auth pattern del navbar entendido | ✅ | Usa `userEmail` state + Supabase `onAuthStateChange`; el hook puede usar `enabled={!!userEmail}` |
| IR-05 | Tabla `agent_keys` tiene `user_id` | ⚠️ | **Verificar:** el endpoint existente busca por `key_hash`, no por `user_id`. Confirmar que `agent_keys` tiene `user_id` o equivalente para la query del nuevo endpoint |
| IR-06 | RLS en `agent_keys` permite `SELECT` por `auth.uid()` | ⚠️ | **Verificar antes de implementar.** Si no hay policy, añadir: `CREATE POLICY "users_read_own_keys" ON agent_keys FOR SELECT USING (user_id = auth.uid())` |
| IR-07 | Tailwind colors `green-*`, `yellow-*`, `red-*` disponibles | ✅ | Tailwind está configurado; colores estándar — no requieren config adicional |
| IR-08 | Íconos disponibles en el proyecto | ⚠️ | Verificar si hay librería de íconos instalada (lucide-react, heroicons, etc.) o si se usan SVGs inline como en el logo de la navbar |
| IR-09 | i18n necesaria para textos del componente | ⚠️ | El proyecto usa `next-intl`. Los strings del componente deben ir a `messages/es.json` y `messages/en.json`. Verificar si el namespace `Layout` o `NavBar` ya existe |
| IR-10 | No requiere migración de DB | ✅ | Solo lectura de tabla existente |
| IR-11 | No requiere cambios en contratos on-chain | ✅ | Puramente off-chain/DB |
| IR-12 | Rate limiting en nuevo endpoint | ⚠️ | Evaluar: 60s polling por usuario = bajo volumen. Upstash rate limit recomendado si hay >100 usuarios activos simultáneos. Para MVP puede omitirse con nota de deuda técnica |

### Acciones requeridas antes de Story

1. **Verificar IR-05:** `SELECT user_id FROM agent_keys LIMIT 1` para confirmar la columna existe
2. **Verificar IR-06:** Revisar RLS policies en `agent_keys` en Supabase dashboard
3. **Verificar IR-08:** `cat package.json | grep -E "lucide|heroicons|radix"` para íconos
4. **Verificar IR-09:** Revisar `messages/en.json` para namespace existente de navbar

---

## Dependencias entre archivos

```
WasiNavBar.tsx
  └── ApiKeyBalance.tsx (componente presentacional)
        └── useApiKeyBalance.ts (hook)
              └── GET /api/v1/me/key-balance (endpoint)
                    └── agent_keys tabla (Supabase, solo lectura)
```

---

## Notas de arquitectura

- **No usar SWR/React Query:** el proyecto no los tiene instalados. Implementar polling manual con `setInterval` + `useEffect` es correcto para este caso.
- **`cache: 'no-store'`** en el fetch para evitar que Next.js cachee la respuesta del endpoint.
- **`'use client'`** en `ApiKeyBalance.tsx` (requiere hooks y eventos del browser).
- **El hook exporta `refresh()`** para que otros componentes (futura integración con el invoke flow) puedan forzar una actualización inmediata post-invocación sin acoplar al hook internamente.
- **Datos stale en error:** nunca mostrar `$0.00` si tenemos datos previos — eso sería confuso. Mostrar el último valor con ícono de advertencia.

---

*Pendiente: SPEC_APPROVED explícito de Fer para proceder a SM → story-ux-05.md*
