# Build Report — WAS-204: Compose Retry from Failed Step
**Date:** 2026-03-13 | **Sprint:** 2 | **Builder:** NexusAgile v1.3

---

## Waves Ejecutadas

### Wave 1 — DB Migration ✅
- **Archivo creado:** `supabase/migrations/052_pipeline_step_outputs.sql`
- **Cambios:**
  - `ALTER TABLE pipeline_executions ADD COLUMN IF NOT EXISTS step_outputs JSONB DEFAULT '[]'::jsonb`
  - RPC `get_pipeline_for_retry(UUID, TEXT)` — SELECT FOR UPDATE, ownership check
  - RPC `append_step_output(UUID, INTEGER, TEXT, TEXT)` — best-effort accumulator
  - REVOKE/GRANT correctos en ambas RPCs (solo service_role)
- **DB Push:** Aplicado en AMBOS entornos:
  - `bdwvrwzvsldephfibmuu` (producción) ✅
  - `caldzjhjgctpgodldqav` (staging) ✅
- **Workaround duplicados:** archivos `.bak` renombrados antes del push y restaurados después ✅
- **Build gate Wave 1:** Solo errores pre-existentes en `.next/types/validator.ts` (5 rutas internas faltantes, presentes antes del PR). Sin errores nuevos. ✅

### Wave 2 — compose/route.ts ✅
- **Archivo modificado:** `src/app/api/v1/compose/route.ts`
- **Cambios implementados:**
  - **2.1** Interface `ComposeRequest` extendida con `start_from_step?`, `pipeline_id?`, `initial_input?`
  - **2.2** N/A — El archivo usa `validateSteps()` manual (no Zod). Los campos opcionales fueron agregados a la interface TypeScript; la validación manual no los rechaza.
  - **2.3** Bloque `RETRY MODE (WAS-204)` insertado después del auth/keyRow y antes del SSRF preflight. Llama a `get_pipeline_for_retry` RPC con checks de 404/409/403.
  - **2.4** `lastOutput` inicial setteado a `retryLastOutput` cuando `resumedFromStep` está definido. Skip de steps antes de `resumedFromStep` con `continue` (no se ejecutan, no se cobran).
  - **2.5** `resumed_from_step` agregado al response final (spread condicional). Interface `ComposeResponse` actualizada con `resumed_from_step?: number`.
  - **2.6** `append_step_output` RPC llamado best-effort (`.then(undefined, () => undefined)`) después de cada step secuencial exitoso.
- **Build gate Wave 2:** Mismos 5 errores pre-existentes en `.next/types/validator.ts`. Sin errores nuevos en código modificado. ✅

---

## Commit

```
hash:    95168e5
message: feat(WAS-204): compose retry from failed step — step_outputs + get_pipeline_for_retry RPC + start_from_step
files:   2 files changed, 145 insertions(+), 9 deletions(-)
         supabase/migrations/052_pipeline_step_outputs.sql (new)
         src/app/api/v1/compose/route.ts (modified)
```

**git push:** NO ejecutado (per reglas).

---

## Archivos Cambiados

| Archivo | Tipo | Descripción |
|---------|------|-------------|
| `supabase/migrations/052_pipeline_step_outputs.sql` | Nuevo | Migration: columna step_outputs + 2 RPCs |
| `src/app/api/v1/compose/route.ts` | Modificado | Retry mode, skip steps, append_step_output, resumed_from_step |

---

## Discrepancias Encontradas

1. **No hay schema Zod en compose/route.ts** — El SDD-204 §2.2 indica "Actualizar el schema Zod de validación (busca `z.object` con `steps`)". El archivo usa validación manual con `validateSteps()` (sin Zod). Los 3 campos opcionales se agregaron a la interface TypeScript; la función `validateSteps()` no los valida ni los rechaza, lo cual es correcto para campos opcionales.

2. **`--include-all` flag requerido** — El comando `npx supabase db push` devolvió error porque la migración 052 tenía timestamp anterior al último aplicado en remote. Se requirió `--include-all` para aplicar. Ambos entornos aceptaron la migración sin problemas.

3. **Errores TSC pre-existentes** — 5 errores en `.next/types/validator.ts` relacionados con rutas de agentes internos que no existen en el filesystem. Presentes antes del PR, no relacionados con WAS-204.
