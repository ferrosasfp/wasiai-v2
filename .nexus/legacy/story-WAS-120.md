# Story File — WAS-120: Playwright CI GitHub Actions Suite
**NNN:** 029 | **SP:** 3 | **P:** P0 | **HU_APPROVED** ✅  
**Fecha:** 2026-03-03 | **Architect:** San (NexusAgil QUALITY)

---

## Resumen

Configurar GitHub Actions workflow que ejecute los tests E2E de Playwright contra producción (`https://wasiai-v2.vercel.app`) en cada push/PR a master/main. Agregar `data-testid` en LanguageSwitcher para estabilidad del AC-3. Cero secrets requeridos.

---

## Wave 0 — Cambios Base (serial, en orden)

### W0.1 — Modificar `playwright.config.ts`

**Archivo:** `playwright.config.ts`  
**Cambio:** Leer baseURL desde env var y hacer webServer condicional

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
      },
})
```

---

### W0.2 — Agregar `data-testid` en `src/components/LanguageSwitcher.tsx`

**Archivo:** `src/components/LanguageSwitcher.tsx`  
**Cambio:** Agregar `data-testid` a los dos botones

```tsx
'use client'

import { usePathname } from 'next/navigation'
import { useRouter } from 'next/navigation'

export function LanguageSwitcher() {
  const router = useRouter()
  const rawPathname = usePathname()
  const currentLocale = rawPathname.startsWith('/es') ? 'es' : 'en'

  function switchLocale(newLocale: string) {
    if (newLocale === currentLocale) return
    const pathWithoutLocale = rawPathname.replace(new RegExp(`^/${currentLocale}`), '')
    router.push(`/${newLocale}${pathWithoutLocale}`)
  }

  return (
    <div
      className="flex items-center gap-1 text-xs font-medium"
      role="group"
      aria-label="Change language / Cambiar idioma"
    >
      <button
        type="button"
        data-testid="lang-en"
        onClick={() => switchLocale('en')}
        aria-pressed={currentLocale === 'en'}
        aria-label="Switch to English"
        className={`rounded px-1.5 py-0.5 transition-colors ${
          currentLocale === 'en'
            ? 'font-bold text-gray-900'
            : 'text-gray-400 opacity-50 hover:text-gray-600'
        }`}
      >
        EN
      </button>
      <span className="text-gray-300" aria-hidden="true">|</span>
      <button
        type="button"
        data-testid="lang-es"
        onClick={() => switchLocale('es')}
        aria-pressed={currentLocale === 'es'}
        aria-label="Cambiar a Español"
        className={`rounded px-1.5 py-0.5 transition-colors ${
          currentLocale === 'es'
            ? 'font-bold text-gray-900'
            : 'text-gray-400 opacity-50 hover:text-gray-600'
        }`}
      >
        ES
      </button>
    </div>
  )
}
```

---

### W0.3 — Crear `.github/workflows/e2e.yml`

**Archivo:** `.github/workflows/e2e.yml` (crear directorio `.github/workflows/` primero)

```yaml
name: E2E Tests

on:
  push:
    branches: [master, main]
  pull_request:
    branches: [master, main]

env:
  PLAYWRIGHT_BASE_URL: https://wasiai-v2.vercel.app
  CI: true

jobs:
  e2e-tests:
    name: Playwright E2E
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright Chromium
        run: npx playwright install chromium --with-deps

      - name: Run E2E tests
        run: npx playwright test

      - name: Upload Playwright report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

---

### W0.4 — Crear `e2e/language-switcher.spec.ts`

**Archivo:** `e2e/language-switcher.spec.ts` (nuevo)

```ts
import { test, expect } from '@playwright/test'

test.describe('Language Switcher (AC-3)', () => {
  test('EN button has data-testid and switches to English', async ({ page }) => {
    await page.goto('/es')
    const enBtn = page.locator('[data-testid="lang-en"]')
    await expect(enBtn).toBeVisible()
    await enBtn.click()
    await expect(page).toHaveURL(/\/en/)
  })

  test('ES button has data-testid and switches to Spanish', async ({ page }) => {
    await page.goto('/en')
    const esBtn = page.locator('[data-testid="lang-es"]')
    await expect(esBtn).toBeVisible()
    await esBtn.click()
    await expect(page).toHaveURL(/\/es/)
  })

  test('active locale button has aria-pressed=true', async ({ page }) => {
    await page.goto('/en')
    const enBtn = page.locator('[data-testid="lang-en"]')
    await expect(enBtn).toHaveAttribute('aria-pressed', 'true')
    const esBtn = page.locator('[data-testid="lang-es"]')
    await expect(esBtn).toHaveAttribute('aria-pressed', 'false')
  })

  test('language switcher is visible on login page', async ({ page }) => {
    await page.goto('/en/login')
    await expect(page.locator('[data-testid="lang-en"]')).toBeVisible()
    await expect(page.locator('[data-testid="lang-es"]')).toBeVisible()
  })

  test('switch preserves path on language change', async ({ page }) => {
    await page.goto('/en/login')
    await page.locator('[data-testid="lang-es"]').click()
    await expect(page).toHaveURL(/\/es\/login/)
  })
})
```

---

## Archivos a crear/modificar

| Acción | Archivo |
|---|---|
| MODIFICAR | `playwright.config.ts` |
| MODIFICAR | `src/components/LanguageSwitcher.tsx` |
| CREAR | `.github/workflows/e2e.yml` |
| CREAR | `e2e/language-switcher.spec.ts` |

---

## DoD (Definition of Done)

- [ ] `playwright.config.ts` usa `process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'`
- [ ] `playwright.config.ts` tiene `webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {...}`
- [ ] `LanguageSwitcher.tsx` botón EN tiene `data-testid="lang-en"`
- [ ] `LanguageSwitcher.tsx` botón ES tiene `data-testid="lang-es"`
- [ ] `.github/workflows/e2e.yml` existe con `PLAYWRIGHT_BASE_URL: https://wasiai-v2.vercel.app`
- [ ] `e2e/language-switcher.spec.ts` existe con 5 tests
- [ ] `npx playwright test --reporter=list` pasa localmente (con dev server corriendo)
- [ ] Cero secrets configurados en GitHub para este workflow
- [ ] Artifacts `playwright-report/` subidos en workflow con `if: always()`
- [ ] `git push origin master && git push origin master:main` exitoso
