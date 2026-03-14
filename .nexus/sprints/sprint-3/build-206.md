# Build Report — WAS-206 IDOR-001
**Fecha:** 2026-03-13  
**Builder:** NexusAgil v1.3 subagent  
**Branch:** main (commit 67e0a8e)

---

## Wave 0 — Pre-flight ✅

| Check | Resultado |
|-------|-----------|
| 052 existe | ✅ confirmado |
| 055 no existe | ✅ (solo hasta 054) |
| Bug confirmado en 052 | ✅ `pe.step_outputs` siempre expuesto |
| compose/route.ts check `!pipeline.owned_by_key` | ✅ en pie (línea ~362) |
| doc/DB_SCHEMA.md | ✅ `pipeline_executions.key_id` → `agent_keys.id` |
| Build baseline (tsc --noEmit) | ✅ solo errores pre-existentes en `.next/types/validator.ts` |

---

## Wave 1 — SQL Fix ✅

**Archivo creado:** `supabase/migrations/055_idor_pipeline_ownership.sql`

**Cambio clave:**
```sql
-- ANTES (052): pe.step_outputs siempre expuesto
pe.step_outputs,

-- AHORA (055): CASE WHEN oculta datos al no-owner
CASE WHEN ak.key_hash = p_key_hash THEN pe.step_outputs ELSE NULL END AS step_outputs,
```

**Estructura mantenida:**
- `CREATE OR REPLACE FUNCTION get_pipeline_for_retry` ✅
- `RETURNS TABLE` con `owned_by_key BOOLEAN` ✅
- `FOR UPDATE` ✅
- `SECURITY DEFINER` ✅
- `REVOKE FROM PUBLIC` + `GRANT service_role` ✅
- `WHERE pe.id = p_pipeline_id` (sin key_hash en WHERE) ✅

**Build gate:** `npx tsc --noEmit` — solo errores pre-existentes ✅

---

## Wave 2 — Aplicar y Verificar ✅

**Migración aplicada en testnet (bdwvrwzvsldephfibmuu) via Supabase Management API**  
Método: `POST /v1/projects/{ref}/database/query` (pooler URL falló, se usó API directa)

**Verificación en DB:**
```
Has CASE WHEN: true
Has pe.step_outputs directly: false  ← IDOR eliminado
```

### Acceptance Criteria

| AC | Escenario | Resultado |
|----|-----------|-----------|
| AC-1 | key_hash incorrecto → `owned_by_key=false`, `step_outputs=null` | ✅ PASS |
| AC-2 | key_hash correcto → `owned_by_key=true`, `step_outputs` presente | ✅ PASS |
| AC-3 | pipeline inexistente → 0 rows (→ 404 en app) | ✅ PASS |
| AC-4 | compose/route.ts retorna 403 cuando `owned_by_key=false` | ✅ (lógica pre-existente, ahora data=null) |
| AC-5 | `npx tsc --noEmit` | ✅ PASS |

**Commit:** `fix(WAS-206): IDOR-001 — step_outputs solo expuesto al owner vía CASE WHEN`  
**Hash:** 67e0a8e  
**git push:** NO (per SDD constraint)  
**mainnet:** NO aplicado (per SDD constraint — solo testnet)

---

## Resultado Final

🟢 **IMPLEMENTACIÓN COMPLETA** — IDOR-001 cerrado.  
`step_outputs` de pipelines ajenos ya no se expone. El 403 pre-existente en compose/route.ts ahora es verdaderamente seguro: incluso si el check fallara, `step_outputs=null` en DB.
