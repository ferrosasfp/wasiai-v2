# SDD-029 — Playwright CI GitHub Actions Suite
**HU:** WAS-120 | **NNN:** 029 | **SP:** 3 | **P:** P0  
**Fase:** F2 — Software Design Document  
**Fecha:** 2026-03-03  
**Architect:** San (NexusAgil QUALITY)

---

## 1. Context Map

### Archivos leídos en Codebase Grounding

| Archivo | Estado | Relevancia |
|---|---|---|
| `playwright.config.ts` | ✅ existe | baseURL=localhost:3000, webServer=npm run dev, CI flags |
| `e2e/navigation.spec.ts` | ✅ existe | 4 tests i18n/nav |
| `e2e/auth.spec.ts` | ✅ existe | 6 tests auth flow |
| `e2e/storage.spec.ts` | ✅ existe | 2 tests auth-guard |
| `e2e/wallet.spec.ts` | ✅ existe | 3 tests auth-guard |
| `src/components/LanguageSwitcher.tsx` | ✅ existe | botones EN/ES sin data-testid |
| `.env.local` | ✅ existe | 18 NEXT_PUBLIC_ vars |
| `.github/` | ❌ no existe | crear desde cero |

### Estado actual de tests
- 15 tests E2E existentes — todos read-only (navegación, redirects, page loads)
- `playwright.config.ts` usa `webServer: { command: 'npm run dev' }` — incompatible con prod-URL strategy
- Sin `data-testid` en LanguageSwitcher — AC-3 inestable sin ellos

---

## 2. D1 — GitHub Secrets Requeridos

### Decisión: **CERO secrets requeridos**

**Justificación:**  
La estrategia elegida (D2-A) testea contra `https://wasiai-v2.vercel.app` sin levantar servidor local.  
Los tests son 100% read-only — ninguno hace writes, mutations de DB ni pagos reales.  
No se ejecuta `npm run build` en CI, por lo que no se necesitan `NEXT_PUBLIC_*` vars.

### Variables de workflow (no-secret, hardcoded en yml)

```
PLAYWRIGHT_BASE_URL=https://wasiai-v2.vercel.app
CI=true
```

### Si en el futuro se necesitara build local (D2-B fallback)

| Secret name (GitHub) | Origen | Descripción |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard | URL del proyecto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard | Anon key pública |
| `NEXT_PUBLIC_SITE_URL` | Vercel | URL de producción |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | `en` | Locale por defecto |
| `NEXT_PUBLIC_DEFAULT_NETWORK` | `fuji\|mainnet` | Red blockchain |
| `NEXT_PUBLIC_RPC_MAINNET` | Alchemy/Infura | RPC Avalanche mainnet |
| `NEXT_PUBLIC_RPC_TESTNET` | Alchemy/Infura | RPC Fuji testnet |
| `NEXT_PUBLIC_STORAGE_GATEWAY` | Pinata | Gateway IPFS |
| `NEXT_PUBLIC_CHAIN_ID` | `43113\|43114` | Chain ID |
| Los 9 restantes | Contratos desplegados | Addresses on-chain |

**→ Para D2-A: ningún secret es necesario hoy.**

---

## 3. D2 — Estrategia de Test: Producción (Opción A) ✅

### Decisión: **Opción A — Tests contra `https://wasiai-v2.vercel.app`**

**Justificación técnica:**
1. Los 15 tests existentes son read-only (navegación, redirects HTTP, visibilidad de elementos)
2. Evita 3-5 min de `npm run build` en cada CI run
3. Evita configurar 18 secrets en GitHub
4. Vercel ya ejecuta build en cada PR via Vercel Bot — no duplicar
5. Si la URL de prod es accesible, los tests son deterministas

**Trade-off aceptado:**
- Tests fallan si Vercel está caído → aceptable (P0: necesitamos saber si prod está rota)
- Tests corren contra prod real → solo tests de navegación, sin side effects

**Configuración requerida en `playwright.config.ts`:**
```ts
baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
// webServer solo cuando NO hay PLAYWRIGHT_BASE_URL
webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
  command: 'npm run dev',
  url: 'http://localhost:3000',
  reuseExistingServer: !process.env.CI,
},
```

---

## 4. D3 — data-testid en LanguageSwitcher

### Atributos a agregar

```tsx
// Botón EN
<button
  type="button"
  data-testid="lang-en"           // ← AGREGAR
  onClick={() => switchLocale('en')}
  aria-pressed={currentLocale === 'en'}
  aria-label="Switch to English"
  ...
>

// Botón ES  
<button
  type="button"
  data-testid="lang-es"           // ← AGREGAR
  onClick={() => switchLocale('es')}
  aria-pressed={currentLocale === 'es'}
  aria-label="Cambiar a Español"
  ...
>
```

### Selector en tests

```ts
// AC-3: verificar switch de idioma
await page.locator('[data-testid="lang-es"]').click()
await expect(page).toHaveURL(/\/es/)

await page.locator('[data-testid="lang-en"]').click()
await expect(page).toHaveURL(/\/en/)
```

---

## 5. Estructura del Workflow `.github/workflows/e2e.yml`

```
Trigger: push(master, main) + pull_request(master, main)
Job: e2e-tests
  - ubuntu-latest
  - node 20
  - npm ci
  - npx playwright install chromium --with-deps
  - npx playwright test
  - Upload artifacts: playwright-report/ (on failure)
Env:
  PLAYWRIGHT_BASE_URL: https://wasiai-v2.vercel.app
  CI: true
```

---

## 6. Tests a crear/modificar

### Modificar: `playwright.config.ts`
- Leer `PLAYWRIGHT_BASE_URL` desde env
- Condicionar `webServer` solo para desarrollo local

### Crear: `e2e/language-switcher.spec.ts`
- AC-3: switch EN→ES y ES→EN usando `data-testid`
- Verifica URL y aria-pressed state

### Existentes (sin cambios de lógica, solo se benefician del fix de config):
- `e2e/navigation.spec.ts` — 4 tests ✅
- `e2e/auth.spec.ts` — 6 tests ✅  
- `e2e/storage.spec.ts` — 2 tests ✅
- `e2e/wallet.spec.ts` — 3 tests ✅

---

## 7. ACs Técnicos Verificables

| AC | Criterio | Evidencia |
|---|---|---|
| AC-1 | Workflow e2e.yml existe y válido | `cat .github/workflows/e2e.yml` |
| AC-2 | 15+ tests pasan en CI (GitHub Actions green) | Badge en README / Actions log |
| AC-3 | Language switch test usa data-testid | `grep data-testid e2e/language-switcher.spec.ts` |
| AC-4 | 0 secrets requeridos en workflow | `grep secrets .github/workflows/e2e.yml` → vacío |
| AC-5 | playwright.config.ts usa env var | `grep PLAYWRIGHT_BASE_URL playwright.config.ts` |
| AC-6 | Artifacts subidos en fallo | `grep upload-artifact .github/workflows/e2e.yml` |

---

## 8. Constraint Directives

### OBLIGATORIO
- `data-testid="lang-en"` y `data-testid="lang-es"` en LanguageSwitcher antes de AC-3
- `PLAYWRIGHT_BASE_URL` leído desde env en playwright.config.ts
- `webServer` condicional: `undefined` cuando `PLAYWRIGHT_BASE_URL` está definido
- Workflow usa `chromium` únicamente (evitar timeouts en CI con Firefox/webkit)
- `retries: 2` en CI (ya en config actual — mantener)
- `workers: 1` en CI (ya en config actual — mantener)
- Artifacts de reporte subidos siempre (`if: always()`)

### PROHIBIDO
- NO ejecutar `npm run build` en el workflow (rompe D2-A)
- NO agregar secrets de Supabase/blockchain al workflow
- NO testear rutas que requieran autenticación real (sin mock de sesión)
- NO modificar tests existentes — solo agregar `language-switcher.spec.ts`
- NO usar `data-testid` en elementos que no sean interactivos (solo botones/inputs)
