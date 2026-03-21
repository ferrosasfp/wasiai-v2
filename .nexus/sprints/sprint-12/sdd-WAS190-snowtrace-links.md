# SDD WAS-190: Earnings links a Snowtrace

> SPEC_APPROVED: no
> Fecha: 2026-03-17
> Tipo: improvement
> SDD_MODE: mini
> Clasificación: HU-MINOR
> Dependencia: WAS-225 (implementar primero)

---

## 1. Resumen

Integrar `explorerTx()` de `@/lib/chain` en el componente `TransactionHistory` para mostrar tx_hash como links clickeables a Snowtrace. Aplica a AMBOS tipos: settlements (`key_batch_settlements.tx_hash`) y withdrawals (`creator_withdrawal_vouchers.tx_hash` — columna confirmada en migration 043).

---

## 2. Acceptance Criteria
1. WHEN settlement tiene `tx_hash` válido THEN mostrar link usando `explorerTx(tx_hash)`
2. Link abre en tab nueva (`target="_blank" rel="noopener noreferrer"`)
3. IF `tx_hash` es null, vacío o no tiene 66 chars hex THEN no renderizar link
4. IS_FUJI/mainnet manejado automáticamente por `explorerTx()` — no requiere lógica adicional

---

## 3. Context Map

| Archivo | Patrón |
|---------|--------|
| `src/lib/chain.ts` línea 39 | `export const explorerTx = (hash: string) => \`${EXPLORER_URL}/tx/${hash}\`` |
| `src/features/payments/components/PayToCallButton.tsx` línea 233 | `href={explorerTx(ctx.txHash)}` — uso existente |

---

## 4. Diseño Técnico

### Archivos a modificar
| Archivo | Acción |
|---------|--------|
| `src/app/[locale]/creator/dashboard/_components/TransactionHistory.tsx` | Agregar link en items type=settlement Y type=withdrawal |

### Implementación (dentro de TransactionHistory.tsx)

```typescript
import { explorerTx } from '@/lib/chain'

// Helper de validación
function isValidTxHash(hash: string | null | undefined): hash is string {
  return typeof hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(hash)
}

// En el render de settlement item:
{isValidTxHash(item.tx_hash) && (
  <a href={explorerTx(item.tx_hash)} target="_blank" rel="noopener noreferrer"
     className="text-xs text-avax-600 hover:underline font-mono">
    {item.tx_hash.slice(0, 10)}...
    <ExternalLink size={10} className="inline ml-1" />
  </a>
)}
```

### Wave 0 — Pre-flight
- [ ] Confirmar que `explorerTx` está exportado en `src/lib/chain.ts` ✅
- [ ] Confirmar que `TransactionHistory.tsx` existe (depende de WAS-225)

### Build gate
`npx tsc --noEmit` sin errores nuevos

---

## 5. Rollback
Eliminar las líneas del helper `isValidTxHash` y el bloque `<a>` del componente.
