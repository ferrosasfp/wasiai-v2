# Story File #035 — WAS-132: Eliminar recordInvocation() del hot path
> Dev lee SOLO este archivo. No consultar SDD ni Work Item.

## Goal
Eliminar el registro on-chain duplicado que se hace después de cada invocación.
El dinero ya se movió — `agent_calls` en Supabase tiene todo el detalle.
`recordInvocation()` on-chain es auditoría redundante que cuesta ~$0.03 AVAX por llamada.

## Acceptance Criteria
- AC1: Invocación x402 exitosa → se registra en Supabase, SIN llamar recordInvocationOnChain()
- AC2: Invocación Agent Key → comportamiento idéntico al actual (no cambia nada)
- AC3: GET /api/admin/status → sin campo pendingRecordings
- AC4: Cron retry-recordings desactivado
- AC5: Verificar pending_recordings vacía antes de deploy

## Archivos a modificar/eliminar

| Archivo | Acción |
|---------|--------|
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Modificar — eliminar función + llamada + imports |
| `src/lib/chain/pendingRecordings.ts` | **Eliminar archivo completo** |
| `src/app/api/cron/retry-recordings/route.ts` | **Eliminar archivo completo** |
| `src/app/api/admin/status/route.ts` | Modificar — eliminar campo pendingRecordings |
| `vercel.json` | Modificar — eliminar cron retry-recordings si existe |

**NO tocar:**
- `src/lib/contracts/marketplaceClient.ts` — dejar `recordInvocationOnChain()` intacto
- Tabla `agent_calls` en Supabase — no se toca
- Flujo de pagos x402 ni Agent Key

## Waves

### W0 — Pre-deploy check (serial, primero)
1. Consultar Supabase: `SELECT COUNT(*) FROM pending_recordings WHERE resolved_at IS NULL`
2. Si hay registros pendientes → documentar en commit como legacy, no afectan pagos
3. Continuar con W1

### W1 — invoke/route.ts (serial)
1. Leer el archivo completo — anti-alucinación
2. Eliminar `import { recordInvocationOnChain, keyHashToBytes32 } from '@/lib/contracts/marketplaceClient'`
   - Verificar primero que `keyHashToBytes32` no se use en otro lugar del archivo
3. Eliminar `import { enqueuePendingRecording } from '@/lib/chain/pendingRecordings'`
4. Eliminar función completa `recordOnChain()` (líneas ~121-148)
5. Eliminar paso 6: `await recordOnChain(supabase, slug, model, paymentHeader, settlement.transactionHash)`
6. Verificar: `npx tsc --noEmit` sin errores

### W2 — Cleanup archivos (serial, después de W1)
1. Eliminar `src/lib/chain/pendingRecordings.ts`
2. Eliminar `src/app/api/cron/retry-recordings/route.ts`
3. Eliminar directorio si queda vacío: `src/app/api/cron/retry-recordings/`
4. Verificar: `npx tsc --noEmit` sin errores

### W3 — admin/status + vercel.json (serial, después de W2)
1. Leer `src/app/api/admin/status/route.ts` completo
2. Eliminar query a `pending_recordings` y campo `pendingRecordings` de la respuesta
3. Leer `vercel.json` — si existe cron `retry-recordings`, eliminarlo
4. Verificar: `npx tsc --noEmit` sin errores

### W4 — Tests (después de W3)
1. Buscar tests que mocken `recordInvocationOnChain` o `enqueuePendingRecording`
2. Actualizar mocks — eliminar referencias a funciones eliminadas
3. Correr suite completa: `npx vitest run`

## Constraint Directives

### OBLIGATORIO
- Leer invoke/route.ts completo antes de tocar — anti-alucinación
- Verificar que `keyHashToBytes32` no se usa en otro lugar del archivo antes de eliminar el import
- Ejecutar typecheck después de cada wave
- Documentar en commit si hay registros legacy en pending_recordings

### PROHIBIDO
- NO eliminar `recordInvocationOnChain()` de `marketplaceClient.ts`
- NO tocar `settleKeyBatch`, `depositForKey`, ni ningún flujo de pago
- NO modificar tabla `agent_calls` en Supabase
- NO tocar flujo Agent Key — solo el hot path x402 cambia
- NO inventar nada que no esté en este Story File

## Escalation Rule
Si algo no está en este Story File → PARAR y preguntar al Architect.
