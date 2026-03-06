# SDD #001: [BUG] Navbar desktop — saldo USDC invisible (WAS-63)

> SPEC_APPROVED: no
> Fecha: 2026-02-27
> Tipo: bugfix
> SDD_MODE: bugfix
> Branch: fix/001-navbar-usdc-invisible
> Artefactos: doc/sdd/001-navbar-usdc-invisible/

---

## 1. Resumen del bug

En la navbar desktop, el componente `ApiKeyBalance` existe en el DOM pero se renderiza como un elemento fantasma: un bloque casi invisible ("borroso/difuminado") visible entre el tab Docs y el selector de idioma EN|ES. El usuario autenticado no puede leer su saldo USDC.

La causa raíz es una **doble ruta de renderizado con colores de contraste ultrabajo**: cuando `isInitialLoading` es `false` pero `uiStatus` sigue siendo `'loading'` (fetch posterior o polling), el componente renderiza un badge con `bg-gray-50 / border-gray-200 / text-gray-400 / icon text-gray-300` sobre un navbar blanco semitransparente con `backdrop-blur-sm`. El resultado visual es un bloque casi invisible que el usuario percibe como "blur".

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 001 |
| **Tipo** | bugfix |
| **Objetivo** | Corregir la visibilidad del saldo USDC en navbar desktop — el usuario autenticado debe ver siempre un estado legible (skeleton o badge con contraste suficiente), nunca un bloque fantasma. |
| **Scope IN** | `ApiKeyBalance.tsx` — condición de render para `uiStatus === 'loading'`; `WasiNavBar.tsx` — solo si se identifica un problema adicional en el wrapper div. |
| **Scope OUT** | Rediseño del navbar, lógica de auth, cálculo de saldo, otros componentes, `useApiKeyBalance` hook (solo si el fix no requiere tocarlo). |

---

## 3. Repro steps

1. Abrir app en desktop (viewport ≥ 1024px)
2. Estar autenticado o no autenticado
3. Observar el área entre el tab "Docs" y el selector EN|ES
4. **Actual:** bloques borrosos/difuminados; saldo USDC no visible
5. **Expected:** skeleton neutral durante carga, badge legible con saldo real

---

## 4. Context Map (Codebase Grounding)

### Archivos leídos

| Archivo | Por qué | Hallazgo |
|---------|---------|----------|
| `src/components/WasiNavBar.tsx` | Orquesta el navbar — monta ApiKeyBalance | `backdrop-blur-sm` en `<nav>` (línea ~84). Wrapper div de ApiKeyBalance: `hidden sm:flex shrink-0` (línea ~155). `enabled={!!userEmail}` pasa false mientras carga → returns null. |
| `src/features/layout/components/ApiKeyBalance.tsx` | Componente de saldo — renderiza el badge | `if (!enabled) return null` (~línea 105). `if (isInitialLoading)` muestra skeleton (~línea 108). Render del badge: `STATUS_STYLES.loading = 'border-gray-200 bg-gray-50'`, `TEXT_STYLES.loading = 'text-gray-400'`, `ICON_STYLES.loading = 'text-gray-300'` (~líneas 68-86). `renderIcon()` default case devuelve `<IconKey>` con clase `text-gray-300` (~línea 155). |

### Causa raíz — archivo:línea

**Causa principal (`ApiKeyBalance.tsx`):**

| Ubicación | Problema |
|-----------|---------|
| `src/features/layout/components/ApiKeyBalance.tsx:108-113` | `if (isInitialLoading)` retorna skeleton visible — correcto. |
| `src/features/layout/components/ApiKeyBalance.tsx:~126` | **BUG:** No existe guard para `uiStatus === 'loading'` cuando `isInitialLoading === false`. En este estado (fetch posterior / polling) el componente cae al render del badge con `STATUS_STYLES.loading = 'border-gray-200 bg-gray-50'` + `text-gray-400` + icono `text-gray-300`. Sobre fondo blanco/semitransparente = elemento fantasma. |
| `src/features/layout/components/ApiKeyBalance.tsx:68` | `STATUS_STYLES.loading` y `TEXT_STYLES.loading` / `ICON_STYLES.loading` tienen contraste insuficiente para ser el render final del badge (fueron diseñados como estado transitorio con skeleton, no como badge visible). |

**Causa contribuyente (`WasiNavBar.tsx`):**

| Ubicación | Problema |
|-----------|---------|
| `src/components/WasiNavBar.tsx:~84` | `backdrop-blur-sm` en `<nav>` crea `backdrop-filter: blur(4px)` + `bg-white/90`. En WebKit/Blink, este compositing layer puede amplificar el efecto fantasma de elementos hijos con colores muy bajos en opacidad/contraste, haciendo que el badge casi invisible aparezca como "borroso". No es el root cause del invisible, sí agrava la percepción visual. |

### Exemplar para el fix

| Fix en | Seguir patrón de | Razón |
|--------|-----------------|-------|
| `ApiKeyBalance.tsx` render guard | Patrón del guard `isInitialLoading` ya existente (línea 108) | Replicar el mismo patrón añadiendo `uiStatus === 'loading'` como segunda condición de skeleton |

---

## 5. Fix propuesto

### Fix mínimo — solo 1 archivo: `ApiKeyBalance.tsx`

Después del guard `if (isInitialLoading)`, agregar un segundo guard para `uiStatus === 'loading'`:

```
// ANTES (solo cubre el primer fetch):
if (isInitialLoading) {
  return <skeleton />
}
// ... badge con STATUS_STYLES.loading (casi invisible)

// DESPUÉS (cubre todos los estados de loading):
if (isInitialLoading || uiStatus === 'loading') {
  return <skeleton />
}
// ... badge solo cuando hay un estado definitivo
```

**Efecto:** El skeleton visible (`h-7 w-20 animate-pulse rounded-full bg-gray-100`) reemplaza al badge fantasma en TODOS los estados de carga, no solo en el primero.

**Archivos a tocar:**

| Archivo | Línea aprox. | Cambio |
|---------|-------------|--------|
| `src/features/layout/components/ApiKeyBalance.tsx` | ~108 | Cambiar `if (isInitialLoading)` por `if (isInitialLoading \|\| uiStatus === 'loading')` |

**`WasiNavBar.tsx` NO requiere cambios** — el wrapper div y el `enabled={!!userEmail}` son correctos post-WAS-58.

---

## 6. Acceptance Criteria (EARS)

1. **WHEN** el usuario autenticado carga cualquier página con navbar desktop, **THE** componente `ApiKeyBalance` **SHALL** mostrar el saldo USDC con texto legible y sin efectos visuales de blur, transparencia o difuminado.

2. **WHILE** el auth state está cargando (estado de hidratación o fetch en curso), **THE** navbar **SHALL** mostrar un skeleton `animate-pulse bg-gray-100` neutral en lugar de un bloque difuminado visible.

3. **IF** el componente `ApiKeyBalance` recibe `uiStatus === 'loading'` (sea primera carga o polling), **THEN THE** componente **SHALL** renderizar el skeleton, nunca el badge con colores de contraste insuficiente.

4. **WHEN** el usuario no está autenticado (`enabled=false`), **THE** navbar **SHALL** omitir el componente completamente sin artefactos visuales.

---

## 7. Constraint Directives (Anti-Alucinación)

### OBLIGATORIO seguir
- Patrón de guard condicional: seguir el patrón existente en `ApiKeyBalance.tsx:108` (mismo skeleton, misma clase CSS, mismo aria-label)
- Cambio mínimo: una condición OR en una línea
- Imports: no agregar ninguno — el cambio usa solo variables ya existentes (`uiStatus`, `isInitialLoading`)

### PROHIBIDO
- NO modificar `useApiKeyBalance` hook (fuera de scope)
- NO modificar `WasiNavBar.tsx` (el wrapper y enabled son correctos)
- NO cambiar `STATUS_STYLES`, `TEXT_STYLES` o `ICON_STYLES` — son correctos para cuando SÍ hay un estado definitivo
- NO refactorizar lógica adyacente al fix (renderIcon, ariaLabel, tooltips)
- NO agregar dependencias nuevas
- NO cambiar el diseño del skeleton ni del badge
- NO tocar archivos de auth, Supabase, o el hook `useApiKeyBalance`

---

## 8. Implementation Readiness Check

```
READINESS CHECK:
[x] Cada AC tiene al menos 1 archivo asociado en la tabla de archivos
[x] El archivo a modificar tiene Exemplar válido (patrón guard ya en el mismo archivo:108)
[x] No hay [NEEDS CLARIFICATION] pendientes
[x] Constraint Directives incluyen más de 3 PROHIBIDO (6 listados)
[x] Context Map tiene 2 archivos leídos
[x] Scope IN y OUT son explícitos
[x] Sin cambios de BD (N/A)
[x] Fix de 1 línea — riesgo de regresión mínimo
```

---

## 9. DoD (Definition of Done)

- [ ] `ApiKeyBalance.tsx` modificado: condición `if (isInitialLoading || uiStatus === 'loading')` en lugar de `if (isInitialLoading)`
- [ ] En desktop autenticado: no se ven bloques fantasma/difuminados entre Docs y EN|ES
- [ ] En desktop autenticado: se muestra skeleton mientras carga y badge legible cuando hay datos
- [ ] En desktop no autenticado: no hay artefactos visuales (null / espacio vacío limpio)
- [ ] TypeScript: sin errores (`npm run type-check` o equivalente pasa)
- [ ] Sin regresiones en otros estados del badge (ok, warning, exhausted, inactive, error, no_key)
- [ ] AC1–AC4 verificados manualmente en Chrome/Safari desktop

---

## 10. Riesgos

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|------------|
| `uiStatus === 'loading'` no existe como estado posible en la hook (enum diferente) | Baja — está en `BalanceStatus` type importado | Verificar `BalanceStatus` en la hook antes de implementar |
| El skeleton cubre un estado donde el badge SÍ tenía info valiosa | Muy baja — `uiStatus='loading'` es transitorio por definición | Revisar duración del polling en `useApiKeyBalance` |

---

*SDD generado por NexusAgil — Architect — Sprint 9 — BUGFIX*
