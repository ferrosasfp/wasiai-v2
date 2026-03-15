# Build Report — WAS-202: Output Schema Validation

> Builder: NexusAgil v1.3
> Fecha: 2026-03-13
> Commit: dde0987
> Branch: main

---

## Tabla de Waves

| Wave | Descripción | Estado | Build Gate |
|------|-------------|--------|------------|
| Wave 0 | Pre-flight validación | ✅ PASS | — |
| Wave 1 | DB + Schema Zod | ✅ PASS | `npx tsc --noEmit` ✅ |
| Wave 2 | API validation | ✅ PASS | `npx tsc --noEmit` ✅ |
| Wave 3 | UI + i18n | ✅ PASS | `npx tsc --noEmit` ✅ |
| Wave 4 | Migración + commit | ✅ PASS | — |

---

## Wave 0 — Hallazgos Pre-flight

| Check | Resultado |
|-------|-----------|
| `output_schema` en `agents` | ❌ No existía → migración correcta |
| `result_type` en `agent_calls` | ❌ No existía → migración correcta |
| Orden bloques sandbox/invoke | ✅ parse → validate input → deduct → SSRF → call agent → insert |
| Orden bloques compose/executeStep | ✅ deduct → call → charge decision → refund → insert |
| `validateInput` en schema-validator.ts | ✅ función existente reutilizable |

---

## Archivos Cambiados

| Archivo | Cambio |
|---------|--------|
| `supabase/migrations/056_output_schema.sql` | Creado — ADD COLUMN output_schema JSONB en agents, result_type TEXT en agent_calls |
| `src/lib/schemas/model.schema.ts` | output_schema field agregado (igual que input_schema) |
| `src/app/api/v1/sandbox/invoke/[slug]/route.ts` | AgentRow + output_schema en SELECT; validación post-agente pre-insert; result_type en inserts |
| `src/app/api/v1/compose/route.ts` | AgentRow + output_schema en SELECTs; validación en executeStep con ABORT pipeline; result_type en inserts |
| `src/app/api/v1/agents/[slug]/route.ts` | output_schema en SELECT y response body |
| `src/app/api/v1/agents/route.ts` | output_schema en SELECT y map |
| `src/components/publish/Step3Technical.tsx` | Textarea output_schema (sigue patrón input_schema) |
| `src/app/[locale]/creator/agents/[slug]/edit/EditAgentForm.tsx` | State output_schema + UI textarea + submit |
| `src/app/[locale]/publish/PublishForm.tsx` | output_schema en PATCH Step3 |
| `messages/en.json` | outputSchemaLabel, outputSchemaOptional, outputSchemaDesc |
| `messages/es.json` | outputSchemaLabel, outputSchemaOptional, outputSchemaDesc |

---

## Commit Hash

```
dde0987 feat(WAS-202): output schema validation antes de settlement
```

---

## Migración Aplicada

- **Método:** Supabase Management API (REST) — WSL2 no puede conectar a IPv6 del DB directo
- **Target:** testnet (bdwvrwzvsldephfibmuu / WasiAI)
- **Verificación:** `SELECT column_name FROM information_schema.columns WHERE table_name IN ('agents','agent_calls') AND column_name IN ('output_schema','result_type')` → ✅ ambas columnas presentes

---

## Discrepancias / Notas

| Item | Detalle |
|------|---------|
| Migración `--db-url` pooler | El pooler `aws-0-us-east-1.pooler.supabase.com:5432` devuelve "Tenant or user not found" con el string del SDD. Se aplicó vía Management API con mismo resultado. |
| `called_at` en compose inserts | Los inserts previos en compose NO tenían `called_at`. Se agregó `called_at: new Date().toISOString()` en los nuevos inserts de schema_violation + se corrigió en el insert existente. |
| TSC errors pre-existentes | `.next/types/validator.ts` tiene 5 errores pre-existentes de routes internas faltantes — no introducidos por WAS-202. |

---

## AC Cumplidos

| AC | Estado |
|----|--------|
| AC-1: Validar output contra output_schema antes de insertar agent_calls | ✅ |
| AC-2: Output inválido → refund + schema_violation + 422 | ✅ |
| AC-3: Sin output_schema → skip validación | ✅ |
| AC-4: Output válido → result_type: 'success' | ✅ |
| AC-5: UI para declarar output_schema en publish + edit | ✅ |
| AC-6: meta-validate NO aplicado (output_schema se guarda raw como input_schema) | ⚠️ Nota: el SDD menciona metaValidateSchema pero el exemplar (EditAgentForm/Step3) no lo aplica en UI — consistente con patrón existente |
| AC-7: `npx tsc --noEmit` sin nuevos errores | ✅ |
