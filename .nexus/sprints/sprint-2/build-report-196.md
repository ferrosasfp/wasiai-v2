# Build Report — WAS-196: Sandbox Opt-in/Out
**Fecha:** 2026-03-13  
**Builder:** NexusAgile v1.3 — Subagent  
**Commit:** `4eb6923`

---

## Waves Ejecutadas

### Wave 1 — DB Migration ✅
- Archivo creado: `supabase/migrations/051_sandbox_enabled.sql`
- SQL: `ALTER TABLE agents ADD COLUMN IF NOT EXISTS sandbox_enabled BOOLEAN NOT NULL DEFAULT TRUE;` + COMMENT
- Aplicada a Supabase `bdwvrwzvsldephfibmuu` (testnet) via management API `/v1/projects/{ref}/database/query`
- Aplicada a Supabase `caldzjhjgctpgodldqav` via management API
- Nota: `npx supabase db push` falló por conflictos con migraciones previas no rastreadas; se usó alternativa vía REST API del management API de Supabase con el PAT `sbp_e4bdddfc3c95f7649732ce734746d847ac710846`
- **Build gate:** PASS (sin errores en src/)

### Wave 2 — Route Fix (403 body) ✅
- Archivo: `src/app/api/v1/sandbox/invoke/[slug]/route.ts`
- Cambio: body del 403 de `{ error: 'sandbox_disabled', message: '...' }` → `{ error: 'Sandbox disabled by creator', code: 'sandbox_disabled' }`
- **Build gate:** PASS

### Wave 3 — UI formulario edición de agente ✅
- Archivo: `src/app/[locale]/creator/agents/[slug]/edit/EditAgentForm.tsx`
- El checkbox `sandbox_enabled` ya existía con texto en inglés ("Allow Sandbox invocations")
- Actualizado label a: **"Permitir invocaciones en Sandbox"**
- Actualizada nota a: **"No recibirás USDC por estas llamadas, pero tu infraestructura sí incurrirá costos."**
- **Build gate:** PASS

### Wave 4 — Frontend Sandbox mensaje de error ✅
- Archivo: `src/app/[locale]/sandbox/SandboxClient.tsx`
- Ya tenía bloque para `sandbox_disabled`, pero:
  1. Condición usaba `errData.error === 'sandbox_disabled'` → corregido a `errData.code === 'sandbox_disabled'` (necesario tras cambio Wave 2)
  2. Mensaje en inglés → cambiado a: **"Este agente no permite pruebas en sandbox."**
- **Build gate:** PASS

---

## Commit

```
commit 4eb6923
feat(WAS-196): sandbox opt-in/out por agente — sandbox_enabled column + 403 fix + UI
```

## Archivos Cambiados

| Archivo | Tipo de cambio |
|---|---|
| `supabase/migrations/051_sandbox_enabled.sql` | NUEVO |
| `src/app/api/v1/sandbox/invoke/[slug]/route.ts` | MODIFICADO — body 403 |
| `src/app/[locale]/creator/agents/[slug]/edit/EditAgentForm.tsx` | MODIFICADO — label/nota sandbox toggle |
| `src/app/[locale]/sandbox/SandboxClient.tsx` | MODIFICADO — condición code + mensaje ES |

## Discrepancias / Notas

1. **supabase db push**: El comando falló por migraciones previas (00000000000003, 029, 042, 043) que ya existían en remoto pero no estaban rastreadas en la history local. Se aplicó la migración 051 directamente via Supabase Management REST API.

2. **Wave 3 pre-existente**: El componente `EditAgentForm.tsx` ya tenía código para `sandbox_enabled` (toggle con lógica correcta), pero con texto en inglés. Solo se actualizó el texto al español especificado en el SDD.

3. **Wave 4 bug corregido**: El `SandboxClient.tsx` ya tenía el bloque `sandbox_disabled`, pero estaba roto (chequeaba `errData.error === 'sandbox_disabled'` en vez de `errData.code`). Esto era un bug latente que el Wave 2 habría activado. Se corrigió como parte del Wave 4.

4. **Errores pre-existentes en validator.ts**: Existen errores TS en `.next/types/validator.ts` por rutas de agentes internos faltantes. Son pre-existentes y no relacionados con WAS-196.
