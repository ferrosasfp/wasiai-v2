# Report — SDD #018: EIP-712 signature verification en admin panel
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-02
**Issue:** WAS-74-deuda

## Resumen
Se reemplazó la verificación insegura `X-Admin-Signature: address` por firma EIP-712 real. El cliente firma `{ action, nonce, timestamp }` con `signTypedData` antes de cada acción admin. El servidor verifica con `recoverTypedDataAddress` de viem y rechaza si el firmante no es owner/operator o el timestamp tiene más de 5 minutos (anti-replay).

Se creó el helper `verifyAdminSignature.ts` reutilizable, se actualizaron los endpoints `/api/admin/fee` y `/api/admin/settlement`, y se modificó el admin page para firmar EIP-712 antes de cada acción. Se agregó `WASIAI_OWNER_ADDRESS` como variable de entorno server-side.

## Archivos principales
- `src/lib/admin/verifyAdminSignature.ts` (nuevo)
- `src/app/api/admin/fee/route.ts` (modificado)
- `src/app/api/admin/settlement/route.ts` (modificado)
- `src/app/[locale]/admin/page.tsx` (modificado — signTypedData)

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales se preservan sin modificación.
