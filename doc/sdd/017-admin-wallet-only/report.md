# Report — SDD #017: Admin panel wallet-only (sin Supabase auth)
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-02
**Issue:** WAS-117

## Resumen
Se eliminó la dependencia de sesión Supabase en `/en/admin`. La wallet address es ahora la única identidad requerida. Sin wallet conectada se muestra botón Connect Wallet; sin permisos de owner/operator se muestra "Access restricted"; con wallet autorizada se otorga acceso completo al panel.

El layout del admin fue simplificado eliminando imports de Supabase y redirects de next/navigation, dejándolo como un layout puro que delega la verificación de permisos al cliente.

## Archivos principales
- `src/app/[locale]/admin/layout.tsx` (modificado — eliminada auth Supabase)
- `src/app/[locale]/admin/page.tsx` (modificado — botón Connect Wallet)

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales se preservan sin modificación.
