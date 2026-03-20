# SDD #16: [BUG] settleKeyBatchOnChain sin waitForTransactionReceipt

> SPEC_APPROVED: no
> Fecha: 2026-03-17
> Tipo: bugfix
> SDD_MODE: bugfix
> Branch: main (direct commit)

---

## 1. Resumen del bug

`settleKeyBatchOnChain` en `marketplaceClient.ts` no espera confirmación on-chain después de `writeContract`. Si la tx revierte, devuelve el hash como exitoso y `runSettlement` marca `settled_at` en la DB, creando inconsistencia DB vs on-chain (limbo de fondos).

Las otras 3 funciones que escriben on-chain (`withdrawForCreator`, `depositForKeyOnChain`, `refundKeyToEarningsOnChain`) SÍ hacen `waitForTransactionReceipt` + check `receipt.status`. Es una inconsistencia del mismo archivo.

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 16 (Engram) |
| **Tipo** | bugfix |
| **Objetivo** | Alinear `settleKeyBatchOnChain` con el patrón HAL-025 del resto del archivo |
| **Scope IN** | Solo `settleKeyBatchOnChain` en `marketplaceClient.ts` |
| **Scope OUT** | Todo lo demás — no refactorizar, no tocar otros métodos |

## 3. Reproducción

### Repro steps
1. Cron `settle-key-batches` se ejecuta
2. `settleKeyBatchOnChain` envía tx con `writeContract`
3. Red congestionada o gas insuficiente → tx revierte on-chain
4. Función devuelve `txHash` como exitoso
5. `runSettlement` marca `settled_at` y `settlement_tx_hash` en DB

### Actual
DB dice "settled" pero on-chain la tx revirtió. Fondos no se movieron.

### Expected
Función detecta revert, retorna `null`, caller NO marca `settled_at`.

## 4. Context Map

### Archivos leídos
| Archivo | Por qué | Hallazgo |
|---------|---------|----------|
| `src/lib/contracts/marketplaceClient.ts` | Ubicación del bug | `withdrawForCreator` (línea ~190) tiene el patrón correcto. `settleKeyBatchOnChain` (línea ~260) no. |
| `src/lib/settlement/runSettlement.ts` | Caller del bug | Línea ~210: `if (txHash)` → marca settled. Si txHash viene de tx revertida, marca incorrectamente. |

### Exemplar para el fix
| Fix en | Seguir patrón de | Razón |
|--------|------------------|-------|
| `settleKeyBatchOnChain` | `withdrawForCreator` (mismo archivo, línea ~190) | Mismo patrón HAL-025: wait + check status + return null on revert |

## 5. Análisis de causa raíz

### Dónde está el bug
| Archivo | Línea/zona | Qué está mal |
|---------|-----------|-------------|
| `src/lib/contracts/marketplaceClient.ts` | `settleKeyBatchOnChain`, después de `writeContract` | Retorna `txHash` inmediatamente sin esperar confirmación |

### Causa raíz
Omisión al implementar — las otras funciones se actualizaron con HAL-025 pero `settleKeyBatchOnChain` no.

### Fix propuesto
Agregar `pub.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 })` + check `receipt.status !== 'success'` → return null. Exactamente el patrón de `withdrawForCreator`.

## 6. Acceptance Criteria (EARS)

1. WHEN `settleKeyBatchOnChain` envía tx, THE sistema SHALL esperar confirmación via `waitForTransactionReceipt` con timeout 30s
2. IF la tx revierte on-chain (`receipt.status !== 'success'`), THEN THE función SHALL loggear error y retornar `null`
3. WHEN tx confirma con `status: success`, THE función SHALL retornar el `txHash`

## 7. Constraint Directives

### OBLIGATORIO seguir
- Patrón HAL-025 de `withdrawForCreator` (mismo archivo)
- Log format: `[marketplace] settleKeyBatch reverted on-chain`

### PROHIBIDO
- NO refactorizar código adyacente
- NO cambiar signature ni return type de la función
- NO modificar otros métodos del archivo

## 8. Riesgos

| Riesgo | Mitigación |
|--------|------------|
| Timeout 30s puede ser corto en red congestionada | Avalanche confirma en ~2s; 30s es 15x margen. Mismo timeout que las otras funciones. |
| waitForReceipt falla por RPC error | Cae en catch → retorna null → caller no marca settled. Seguro. |

---

*SDD generado por NexusAgil — BUGFIX*
