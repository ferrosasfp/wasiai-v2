# Report — SDD #029: Playwright CI — e2e tests en GitHub Actions
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-03
**Issue:** WAS-120

## Resumen
Se configuró una suite de tests E2E con Playwright ejecutándose en GitHub Actions contra la URL de producción (`https://wasiai-v2.vercel.app`). La estrategia elegida (Opción A) ejecuta los 15 tests existentes (navegación, redirects, visibilidad) directamente contra prod sin necesidad de secrets ni build local. Se agregaron `data-testid` al componente LanguageSwitcher para estabilizar los tests de i18n. El workflow CI no requiere variables de entorno secretas ya que todos los tests son read-only.

## Archivos principales
- `.github/workflows/playwright.yml` — workflow de CI
- `playwright.config.ts` — configuración adaptada para CI (baseURL prod)
- `e2e/navigation.spec.ts` — tests de navegación e i18n
- `e2e/auth.spec.ts` — tests de auth flow
- `e2e/storage.spec.ts` — tests auth-guard
- `e2e/wallet.spec.ts` — tests auth-guard
- `src/components/LanguageSwitcher.tsx` — agregados `data-testid`

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales (SDD, story-file) se preservan sin modificación.
