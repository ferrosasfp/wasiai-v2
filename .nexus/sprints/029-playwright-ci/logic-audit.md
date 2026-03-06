# Code Review — WAS-120 Playwright CI
**NNN-029 | Fase: Code Review | Modo: QUALITY**
**Reviewer:** San (NexusAgil Code Reviewer)
**Fecha:** 2026-03-03
**Veredicto global:** ⚠️ CHANGES_REQUESTED

---

## Archivos revisados

| Archivo | Descripción |
|---------|-------------|
| `.github/workflows/e2e.yml` | CI workflow para Playwright |
| `e2e/language-switcher.spec.ts` | Tests del componente LanguageSwitcher |
| `e2e/navigation.spec.ts` | Tests de navegación i18n (referencia) |
| `playwright.config.ts` | Configuración de Playwright |
| `src/components/LanguageSwitcher.tsx` | Componente (selectores `data-testid`) |

---

## 6 Checks

### ✅ 1. Patrones — APPROVED

`language-switcher.spec.ts` sigue el mismo estilo que `navigation.spec.ts`:
- Mismo import: `import { test, expect } from '@playwright/test'`
- Misma estructura: `test.describe(...)` → `test(...)` → `async ({ page }) =>`
- Sin fixtures adicionales, sin helpers innecesarios
- Consistencia total con el patrón del codebase

---

### ✅ 2. Naming — APPROVED

Nombres de tests descriptivos y consistentes:

```
'EN→ES: /en/login switches to /es/login'       ✅ dirección + ruta explícita
'ES→EN: /es/login switches to /en/login'       ✅ simétrico
'regression S17: no double-locale /en/es/login' ✅ referencia al bug, caso concreto
'active locale button has aria-pressed=true'    ✅ comportamiento de accesibilidad claro
'switch preserves path on language change'      ⚠️ nombre genérico para test duplicado
```

El único naming débil es el test 5 — que además está duplicado (ver check 4).

---

### ✅ 3. Complejidad — APPROVED

Todos los tests tienen responsabilidad única:
- Cada test verifica exactamente una cosa: URL final, atributo ARIA, o ausencia de patrón
- Sin lógica condicional, sin loops
- Sin `beforeAll`/`afterAll` innecesarios
- El test de regresión S17 verifica dos assertions pero son coherentes con el mismo escenario

---

### ⚠️ 4. Duplicación — CHANGES_REQUESTED

**Duplicado interno en `language-switcher.spec.ts`:**

Test 1: `'EN→ES: /en/login switches to /es/login'`
```ts
await page.goto('/en/login')
await page.locator('[data-testid="lang-es"]').click()
await expect(page).toHaveURL(/\/es\/login/)
```

Test 5: `'switch preserves path on language change'`
```ts
await page.goto('/en/login')
await page.locator('[data-testid="lang-es"]').click()
await expect(page).toHaveURL(/\/es\/login/)
```

Son **100% idénticos**. El test 5 no agrega valor y genera ruido en el reporte.

**Entre `navigation.spec.ts` y `language-switcher.spec.ts`:** Sin solapamiento. navigation.spec.ts valida routing i18n; language-switcher.spec.ts valida el componente. Separación correcta.

**Acción requerida:** Eliminar el test 5 (`'switch preserves path on language change'`).

---

### ✅ 5. Workflow — APPROVED

`e2e.yml` es mínimo, legible y correcto:

```yaml
✅ Trigger en push/PR a master y main
✅ actions/checkout@v4, setup-node@v4, upload-artifact@v4 (versiones fijadas)
✅ cache: npm (reduce tiempo de CI)
✅ Solo instala chromium (no todos los browsers — correcto para headless CI)
✅ PLAYWRIGHT_BASE_URL apunta a Vercel prod (sin levantar servidor local en CI)
✅ upload-artifact con if: always() y retention-days: 7 (buena práctica)
✅ Sin secretos hardcodeados, sin steps innecesarios
```

Workflow production-ready.

---

### ✅ 6. Mantenibilidad — APPROVED

Selectores `data-testid` son estables:
- `data-testid="lang-en"` (línea 27) y `data-testid="lang-es"` (línea 42) en `LanguageSwitcher.tsx`
- Desacoplados del estilo y estructura DOM → sobreviven refactors de CSS/layout
- Semántica clara: `lang-{código}` → fácil agregar `lang-pt`, `lang-fr`, etc.
- Selectores en tests son directos: `[data-testid="lang-es"]` sin `.nth()` ni índices frágiles

Patrón extensible y robusto.

---

## Resumen de acciones requeridas

| Prioridad | Archivo | Acción |
|-----------|---------|--------|
| 🔴 DEBE CORREGIR | `e2e/language-switcher.spec.ts` | Eliminar test duplicado: `'switch preserves path on language change'` (líneas ~22-26) |

---

## Conclusión

El PR está bien estructurado. Un solo bloqueo: test duplicado que agrega ruido sin valor.
Corregir el duplicado → APPROVED.

```
Patrones      ✅ APPROVED
Naming        ✅ APPROVED
Complejidad   ✅ APPROVED
Duplicación   ⚠️ CHANGES_REQUESTED — test 5 idéntico a test 1
Workflow      ✅ APPROVED
Mantenibilidad ✅ APPROVED
```
