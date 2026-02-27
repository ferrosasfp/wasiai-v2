# Hotfix QA Report — commit bdf2e38
**Fecha:** 2026-02-27  
**Revisor:** San (QA Agent — BMAD Method v6)  
**Commit:** `bdf2e387065e0a3f11c852fbe6d0a469af7b2a65`  
**Tag:** `fix: hotfix WAS-54/55/56/57/58`

---

## Resumen ejecutivo

| Bug | Descripción | Resultado |
|-----|-------------|-----------|
| WAS-54 | Tab Explorar marca Home activo | ✅ RESUELTO |
| WAS-55 | Dashboard mobile tablas desbordadas | ✅ RESUELTO |
| WAS-56 | Analytics en blanco | ✅ RESUELTO |
| WAS-57 | Tab Perfil sin navegación | ✅ RESUELTO |
| WAS-58 | Saldo USDC en blanco | ✅ RESUELTO |

**Veredicto global: ✅ TODOS LOS HOTFIXES VERIFICADOS — LISTO PARA PRODUCCIÓN**

---

## Verificación por bug

### WAS-54 — Tab Explorar marca Home activo
**Archivo:** `src/components/MobileBottomNav.tsx`

**Evidencia:**
- Se añadió estado `hash` inicializado con `window.location.hash` (SSR-safe con guard `typeof window !== 'undefined'`)
- `useEffect` con listener `hashchange` actualiza el estado en tiempo real
- `isExploreHash = hash === '#agents'`
- `isActive()` diferencia correctamente:
  - Explorar: activo cuando `pathname === /${locale}` **Y** `isExploreHash === true`
  - Home: activo cuando en `/` **Y** `!isExploreHash`
- Mutually exclusive — no pueden estar ambos activos simultáneamente

**Resultado: ✅ RESUELTO**

---

### WAS-55 — Dashboard mobile tablas desbordadas
**Archivo:** `src/app/[locale]/creator/dashboard/page.tsx`

**Evidencia:**
- Línea 145: `<div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">`
- Línea 223: segundo wrapper de tabla también tiene `overflow-x-auto`
- Ambas tablas (Agents + Transactions/Calls) tienen wrapper con scroll horizontal

**Resultado: ✅ RESUELTO**

---

### WAS-56 — Analytics en blanco
**Archivo:** `src/app/api/creator/analytics/route.ts`

**Evidencia (líneas 62–68):**
```ts
// WAS-56: Obtener TODOS los agentes del creator (sin filtrar por status activo)
const { data: agentsData } = await svc
  .from('agents')
  .select('id, name')
  .eq('creator_id', profile.id)   // ← sin .eq('status', 'active')
```
- El filtro `.eq('status', 'active')` fue removido del query de agentes en analytics
- Agentes en cualquier status (draft, paused, pending) ahora aparecen en analytics
- El `.eq('status', 'error')` restante es para filtrar `agent_calls` por error — correcto e independiente

**Resultado: ✅ RESUELTO**

---

### WAS-57 — Tab Perfil sin navegación
**Archivo:** `src/components/MobileBottomNav.tsx`

**Evidencia:**
```ts
// WAS-57: profileHref uses same role-based logic as dashboardHref (MVP — DT-NAV-01)
const profileHref = dashboardHref
```
- `dashboardHref` ya tiene lógica correcta por rol:
  - `creator` → `/${locale}/creator/dashboard`
  - `consumer` → `/${locale}/dashboard`
  - sin rol → `/${locale}/login`
- `profileHref` hereda esa lógica; el tab Perfil navega correctamente según rol
- **Nota MVP documentada:** DT-NAV-01 — perfil dedicado es deuda técnica registrada

**Resultado: ✅ RESUELTO**

---

### WAS-58 — Saldo USDC en blanco
**Archivos:**
- `src/components/WasiNavBar.tsx`
- `src/features/layout/hooks/useApiKeyBalance.ts`
- `src/features/layout/components/ApiKeyBalance.tsx`

**Evidencia — race condition fix (WasiNavBar.tsx líneas 46–57):**
```ts
const initialEmailRef = useRef(initialEmail)
// WAS-58: Skip INITIAL_SESSION if initialEmail was already provided by SSR
const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'INITIAL_SESSION' && initialEmailRef.current !== null) {
    // SSR already provided a valid email — ignore client INITIAL_SESSION
    return
  }
  ...
})
```
- `useRef` guarda `initialEmail` del SSR sin provocar re-render
- Si ya hay email del servidor, el evento `INITIAL_SESSION` del cliente se ignora → no borra el email → `ApiKeyBalance` no desaparece

**Evidencia — ApiKeyBalance renderiza con userEmail (WasiNavBar.tsx línea 150–152):**
```tsx
{userEmail && (
  <ApiKeyBalance enabled={!!userEmail} locale={locale} />
```
- `ApiKeyBalance` se monta solo cuando `userEmail` existe
- `enabled={!!userEmail}` controla el hook interno; si no hay sesión, el hook hace early return

**Evidencia — hook usa useRef para mounted guard (useApiKeyBalance.ts líneas 71–73):**
```ts
const isMounted = useRef(true)
const fetchRef  = useRef<(() => Promise<void>) | undefined>(undefined)
```

**Resultado: ✅ RESUELTO**

---

## Checks globales

### Build
```
npm run build → ✅ 0 errores, 0 warnings de ESLint (--max-warnings 0 pasado)
```
El build completó exitosamente con todas las rutas generadas correctamente.

### ethers.js
- Archivos con referencia a `ethers`: `src/lib/receipts/signReceipt.ts` y `src/app/api/v1/compose/route.ts`
- Ambos existían **antes** del commit bdf2e38 — no son adiciones del hotfix
- El diff del commit no muestra ningún archivo nuevo con `ethers`
- **✅ Sin ethers.js nuevos introducidos por el hotfix**

### Strings hardcodeados
- Revisión del diff: solo cambios en lógica de navegación, queries de Supabase y guards de auth
- No se detectaron strings de UI hardcodeados nuevos en los archivos modificados
- **✅ Sin strings hardcodeados nuevos en UI**

---

## Archivos modificados en el commit

| Archivo | Bugs | Cambios |
|---------|------|---------|
| `src/components/MobileBottomNav.tsx` | WAS-54, WAS-57 | +32/-11 líneas |
| `src/components/WasiNavBar.tsx` | WAS-58 | +17/-0 líneas |
| `src/app/[locale]/creator/dashboard/page.tsx` | WAS-55 | +4/-1 líneas |
| `src/app/api/creator/analytics/route.ts` | WAS-56 | +4/-1 líneas |

---

## Decisiones de diseño a monitorear

1. **WAS-57 / DT-NAV-01:** `profileHref = dashboardHref` es una solución MVP documentada. El tab "Perfil" lleva al dashboard (creator o consumer según rol). Cuando exista `/profile` como ruta dedicada, deberá actualizarse.
2. **WAS-54 hash-based nav:** La detección de hash es client-side; en SSR el hash siempre es `''` — correcto y esperado (ya manejado con guard).

---

*QA completado — hotfix aprobado para producción.*
