# Story File — #001: [BUG] Navbar desktop — saldo USDC invisible (WAS-63)

> SDD: doc/sdd/001-navbar-usdc-invisible/sdd.md
> Fecha: 2026-02-27
> Branch: fix/001-navbar-usdc-invisible

---

## Goal

El componente `ApiKeyBalance` en la navbar desktop muestra un bloque fantasma casi invisible cuando `uiStatus === 'loading'` pero `isInitialLoading === false` (fetch posterior o polling activo). Hay que extender el guard de skeleton existente para que cubra **todos** los estados de carga, no solo el fetch inicial.

## Acceptance Criteria (EARS)

1. **WHEN** el usuario autenticado carga cualquier página con navbar desktop, **THE** componente `ApiKeyBalance` **SHALL** mostrar el saldo USDC con texto legible y sin efectos visuales de blur, transparencia o difuminado.

2. **WHILE** el auth state está cargando (estado de hidratación o fetch en curso), **THE** navbar **SHALL** mostrar un skeleton `animate-pulse bg-gray-100` neutral en lugar de un bloque difuminado visible.

3. **IF** el componente `ApiKeyBalance` recibe `uiStatus === 'loading'` (sea primera carga o polling), **THEN THE** componente **SHALL** renderizar el skeleton, nunca el badge con colores de contraste insuficiente.

4. **WHEN** el usuario no está autenticado (`enabled=false`), **THE** navbar **SHALL** omitir el componente completamente sin artefactos visuales.

## Files to Modify/Create

| # | Archivo | Acción | Qué hacer | Exemplar |
|---|---------|--------|-----------|----------|
| 1 | `src/features/layout/components/ApiKeyBalance.tsx` | Modificar | En la línea ~108, cambiar `if (isInitialLoading)` por `if (isInitialLoading \|\| uiStatus === 'loading')` | Mismo archivo — bloque guard existente en línea ~108 |

**Total: 1 archivo, 1 línea.**

`WasiNavBar.tsx` — NO tocar. El wrapper y `enabled={!!userEmail}` son correctos.

## Exemplars

### Exemplar 1: Guard de skeleton en ApiKeyBalance.tsx (líneas 107–114)

**Archivo**: `src/features/layout/components/ApiKeyBalance.tsx`
**Usar para**: el único cambio del archivo #1

**Código actual (leer antes de editar):**
```tsx
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
```

**Código resultante después del fix:**
```tsx
// No montar nada si no hay sesión
if (!enabled) return null

// ── Estado: cargando (fetch inicial O polling) → skeleton ─────────────────
if (isInitialLoading || uiStatus === 'loading') {
  return (
    <div
      className="h-7 w-20 animate-pulse rounded-full bg-gray-100"
      aria-label="Cargando saldo..."
      role="status"
    />
  )
}
```

**Patrón clave:**
- Solo cambiar la condición `if (isInitialLoading)` → `if (isInitialLoading || uiStatus === 'loading')`
- El JSX del skeleton NO cambia: misma clase, mismo aria-label, mismo role
- `uiStatus` ya está desestructurado de `useApiKeyBalance(enabled)` en la línea ~103: `const { uiStatus, data, isInitialLoading } = useApiKeyBalance(enabled)`
- `'loading'` es un valor válido de `BalanceStatus` (ya importado en línea 4)
- No agregar ningún import nuevo

### Exemplar 2: Context — estilos de estado loading (referencia, NO modificar)

**Archivo**: `src/features/layout/components/ApiKeyBalance.tsx` (líneas 68–86)
**Propósito**: entender por qué el badge es invisible (contexto del bug — no tocar estos objetos)

```tsx
const STATUS_STYLES: Record<BalanceStatus, string> = {
  loading:   'border-gray-200 bg-gray-50',   // ← casi invisible sobre blanco
  // ...
}
const TEXT_STYLES: Record<BalanceStatus, string> = {
  loading:   'text-gray-400',                 // ← contraste muy bajo
  // ...
}
const ICON_STYLES: Record<BalanceStatus, string> = {
  loading:   'text-gray-300',                 // ← casi invisible
  // ...
}
```

Estos objetos son correctos para estados definitivos. El problema es que `loading` llegaba al render del badge en vez del skeleton — el fix hace que nunca llegue.

## Constraint Directives

### OBLIGATORIO
- Seguir el patrón del guard existente (línea ~108) — mismo JSX de skeleton, misma clase CSS, mismo aria-label
- Usar solo `uiStatus` e `isInitialLoading` ya desestructuradas de `useApiKeyBalance(enabled)` — no hay nada nuevo que importar
- Cambio mínimo: exactamente 1 condición OR en 1 línea

### PROHIBIDO
- NO modificar `WasiNavBar.tsx` bajo ninguna circunstancia
- NO modificar `useApiKeyBalance` hook
- NO modificar `STATUS_STYLES`, `TEXT_STYLES` o `ICON_STYLES`
- NO refactorizar la función `renderIcon()`, `ariaLabel()`, ni los tooltips
- NO agregar dependencias nuevas
- NO cambiar el diseño del skeleton ni del badge
- NO tocar archivos de auth, Supabase, ni ningún otro archivo fuera de la tabla
- NO "mejorar" código adyacente al fix (imports, formato, comentarios extensos, etc.)

## Test Expectations

| Test | ACs que cubre | Framework | Tipo |
|------|--------------|-----------|------|
| N/A para este fix | — | — | — |

### Criterio Test-First

| Tipo de cambio | Test-first? |
|----------------|-------------|
| Cambio de condición en guard (1 línea) | No — es un bugfix trivial; verificación manual es suficiente |

**No se requieren tests automáticos.** La verificación es manual en Chrome/Safari desktop:
- Con usuario autenticado: confirmar que no hay bloque fantasma entre Docs y EN|ES
- Con usuario no autenticado: confirmar que no hay artefactos

## Waves

### Wave 0 (Serial — único wave)
- [ ] W0.1: Leer `src/features/layout/components/ApiKeyBalance.tsx` completo (verificar líneas exactas del guard)
- [ ] W0.2: Modificar la condición `if (isInitialLoading)` → `if (isInitialLoading || uiStatus === 'loading')` en el guard de skeleton
- [ ] W0.3: Verificar que TypeScript compila sin errores (`npm run type-check` o `tsc --noEmit`)
- [ ] W0.4: Verificación visual manual en desktop autenticado

### Verificación Incremental

| Wave | Verificación al completar |
|------|--------------------------|
| W0 | `npm run type-check` pasa sin errores + verificación visual manual |

## Out of Scope

> Dev NO debe tocar esto bajo ninguna circunstancia.

- `src/components/WasiNavBar.tsx` — no requiere cambios
- `src/features/layout/hooks/useApiKeyBalance.ts` — no requiere cambios
- `STATUS_STYLES`, `TEXT_STYLES`, `ICON_STYLES` en `ApiKeyBalance.tsx` — no modificar
- Cualquier archivo fuera de `src/features/layout/components/ApiKeyBalance.tsx`
- Auth, Supabase, cualquier lógica de fetch
- Estilos del badge para estados definitivos (ok, warning, exhausted, inactive, error, no_key)
- Refactors de ningún tipo en código adyacente
- Cambios en mobile — este bug es desktop, no tocar lógica responsive

## DoD (Definition of Done)

- [ ] `ApiKeyBalance.tsx` modificado: condición `if (isInitialLoading || uiStatus === 'loading')` en lugar de `if (isInitialLoading)` — 1 sola línea cambiada
- [ ] En desktop autenticado: no se ven bloques fantasma/difuminados entre Docs y EN|ES durante la carga
- [ ] En desktop autenticado: skeleton `animate-pulse bg-gray-100` visible mientras carga, badge legible cuando hay datos
- [ ] En desktop no autenticado: no hay artefactos visuales (componente returna null limpiamente)
- [ ] `npm run type-check` (o equivalente) pasa sin errores
- [ ] Sin regresiones en otros estados del badge: `ok`, `warning`, `exhausted`, `inactive`, `error`, `no_key`
- [ ] AC1–AC4 verificados manualmente en Chrome desktop

## Escalation Rule

> **Si algo no está en este Story File, Dev PARA y pregunta a Architect.**
> No inventar. No asumir. No improvisar.

Situaciones de escalation:
- `uiStatus === 'loading'` no existe como valor válido en el tipo `BalanceStatus` (leer el enum antes de implementar)
- El archivo `ApiKeyBalance.tsx` tiene una estructura diferente a la descrita aquí (guard en línea distinta o lógica reorganizada)
- El `npm run type-check` falla por razones no relacionadas con el fix
- Hay ambigüedad sobre si se debe también tocar `WasiNavBar.tsx`

---

*Story File generado por NexusAgil — F2.5 — Architect — Sprint 9*
