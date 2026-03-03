# Adversarial Review — NNN-029
**HU:** WAS-120 Playwright CI  
**Fase:** Adversarial Review (AR)  
**Fecha:** 2026-03-03  
**Adversary:** San / NexusAgil QUALITY  
**Veredicto:** ✅ APPROVED

---

## Tabla de Hallazgos

| # | Ítem | Resultado | Severidad | Evidencia |
|---|------|-----------|-----------|-----------|
| 1 | `e2e.yml` existe y es sintácticamente correcto | ✅ OK | — | `.github/workflows/e2e.yml` presente, YAML válido |
| 2 | 0 secrets de Supabase/blockchain en workflow | ✅ OK | — | Solo `PLAYWRIGHT_BASE_URL` y `CI` en `env:`, sin referencias a `${{ secrets.* }}` |
| 3 | Scope correcto: solo `navigation.spec.ts` + `language-switcher.spec.ts` | ✅ OK | — | `npx playwright test e2e/navigation.spec.ts e2e/language-switcher.spec.ts` — auth/storage/wallet excluidos correctamente |
| 4 | `data-testid="lang-en"` y `data-testid="lang-es"` en `LanguageSwitcher.tsx` | ✅ OK | — | `grep data-testid` confirma ambos atributos presentes |
| 5 | Regresión S17 — test `no double-locale` explícito | ✅ OK | — | `regression S17: no double-locale /en/es/login` en `language-switcher.spec.ts:14` |
| 6 | `if: always()` en `upload-artifact` | ✅ OK | — | `if: always()` presente en step de artifacts |
| 7 | Sin `npm run build` en workflow | ✅ OK | — | Workflow no contiene ningún step de build |
| 7b | Solo chromium instalado | ✅ OK | — | `npx playwright install chromium --with-deps` — sin firefox ni webkit |

---

## Análisis Detallado

### Workflow (e2e.yml)
- Triggers correctos: `push` y `pull_request` sobre `master`/`main`
- Runner `ubuntu-latest` apropiado para CI
- Node 20 con cache `npm` — eficiente
- `npm ci` (no `npm install`) — correcto para CI reproducible
- `retention-days: 7` en artifact — razonable

### Tests (language-switcher.spec.ts)
- 5 tests bien estructurados cubriendo los ACs
- S17 regresión explícitamente nombrada con `url.not.toMatch(/\/en\/es\//)`
- `aria-pressed` testeado — accesibilidad considerada
- Test "preserves path" es redundante con EN→ES pero no es bloqueante

### LanguageSwitcher.tsx
- `data-testid` correctamente colocados en ambos botones
- Alineado con los locators de los tests

---

## Notas de Calidad

- **MENOR (no bloqueante):** El test `switch preserves path on language change` es prácticamente idéntico al test `EN→ES`. En próximas iteraciones considerar consolidar o agregar un path diferente (e.g., `/en/marketplace`) para mayor cobertura.
- **INFO:** 6 tests fallan fuera del scope (auth/storage/wallet) — fuera de WAS-120, no bloquean este AR.

---

## Veredicto Final

**✅ APPROVED** — Todos los ítems del checklist AR pasan sin hallazgos bloqueantes. El Playwright CI de WAS-120 cumple los Constraint Directives, cubre los ACs y la regresión S17. Listo para QA final (F4).
