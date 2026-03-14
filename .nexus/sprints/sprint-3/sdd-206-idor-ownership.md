# SDD #206: [BUGFIX] IDOR-001 — ownership check en WHERE clause de get_pipeline_for_retry

> SPEC_APPROVED: no
> Fecha: 2026-03-13
> Tipo: bugfix / security
> SDD_MODE: bugfix
> Clasificación: QUALITY
> Branch: fix/206-idor-pipeline-ownership

---

## 1. Resumen del bug

`get_pipeline_for_retry` retorna `step_outputs` (datos del pipeline) antes de verificar si la key que hace la llamada es dueña del pipeline. El check `owned_by_key` se hace como columna calculada pero los datos ya llegan a la aplicación.

**Fix:** El RPC devuelve una fila cuando el pipeline existe (sin importar ownership), con `owned_by_key` como flag. Pero `step_outputs` solo se expone si `owned_by_key = true` (CASE WHEN). Así:
- Pipeline no existe → 0 rows → 404
- Pipeline existe, no es tuyo → fila con `owned_by_key=false`, `step_outputs=null` → 403
- Pipeline existe y es tuyo → fila completa → 200

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | WAS-206 |
| **Tipo** | bugfix / security |
| **Objetivo** | No exponer step_outputs de pipelines ajenos |
| **Scope IN** | Migración SQL (CREATE OR REPLACE función) + TypeScript que la consume |
| **Scope OUT** | Otros endpoints, lógica de retry, UI |

### Acceptance Criteria (EARS)

- **AC-1:** WHEN `get_pipeline_for_retry` is called with an incorrect `p_key_hash`, THEN the RPC SHALL return a row with `owned_by_key=false` and `step_outputs=null` (no data exposed)
- **AC-2:** WHEN `get_pipeline_for_retry` is called with the correct `p_key_hash`, THEN the RPC SHALL return the full row including `step_outputs`
- **AC-3:** WHEN RPC returns 0 rows (pipeline not found), THEN `compose/route.ts` SHALL return 404 `pipeline_not_found`
- **AC-4:** WHEN RPC returns a row with `owned_by_key=false`, THEN `compose/route.ts` SHALL return 403 `pipeline_access_denied`
- **AC-5:** WHEN fix is applied, THEN `npx tsc --noEmit` SHALL pass

---

## 3. Context Map

### Archivos leídos
| Archivo | Por qué | Hallazgo |
|---------|---------|----------|
| `supabase/migrations/052_pipeline_step_outputs.sql` | RPC actual | `owned_by_key` calculado pero `step_outputs` siempre expuesto |
| `src/app/api/v1/compose/route.ts` líneas 316-365 | Consumidor RPC | Chequea `!pipeline.owned_by_key` — sigue siendo válido con el nuevo fix |
| `doc/DB_SCHEMA.md` | Columnas | `pipeline_executions.key_id` FK → `agent_keys.id` |

---

## 4. Diseño técnico

**SQL fix — CASE WHEN para step_outputs:**
```sql
SELECT
  pe.id,
  pe.status,
  CASE WHEN ak.key_hash = p_key_hash THEN pe.step_outputs ELSE NULL END AS step_outputs,
  (ak.key_hash = p_key_hash) AS owned_by_key
FROM pipeline_executions pe
JOIN agent_keys ak ON ak.id = pe.key_id
WHERE pe.id = p_pipeline_id
FOR UPDATE;
```

**TypeScript — el check `!pipeline.owned_by_key` ya existe y es correcto.** No hay código muerto. El único cambio es que el 403 ya estaba pero ahora `step_outputs` es null cuando `owned_by_key=false`, lo que elimina el IDOR.

---

## 5. Waves

### Wave 0 — Pre-flight
- [ ] W0.1: `npx tsc --noEmit` baseline
- [ ] W0.2: Leer `052_pipeline_step_outputs.sql` completo
- [ ] W0.3: Leer `compose/route.ts` líneas 316-370 — confirmar que el check `!pipeline.owned_by_key` sigue en pie
- [ ] W0.4: Leer `doc/DB_SCHEMA.md` — confirmar `pipeline_executions.key_id` → `agent_keys.id`

### Wave 1 — SQL fix
- [ ] W1.1: Crear `supabase/migrations/055_idor_pipeline_ownership.sql`
  - `CREATE OR REPLACE FUNCTION get_pipeline_for_retry`
  - CASE WHEN para `step_outputs`
  - Mantener: RETURNS TABLE con `owned_by_key BOOLEAN`, `FOR UPDATE`, `SECURITY DEFINER`, GRANT `service_role`
- [ ] Build gate: `npx tsc --noEmit` ✅

### Wave 2 — Aplicar y verificar
- [ ] W2.1: Aplicar `055` en testnet
- [ ] W2.2: Test: pipeline ajeno → 403; pipeline propio → step_outputs presente; pipeline inexistente → 404
- [ ] W2.3: Aplicar `055` en mainnet
- [ ] W2.4: Commit `fix(WAS-206): IDOR-001 — step_outputs solo expuesto al owner vía CASE WHEN`
- [ ] Build gate: `npx tsc --noEmit` ✅

---

## 6. Constraint Directives

### OBLIGATORIO
- Usar `CREATE OR REPLACE FUNCTION` — misma firma que 052
- GRANT solo a `service_role` + `REVOKE FROM PUBLIC`
- `FOR UPDATE` — mantener para concurrencia
- Consultar `doc/DB_SCHEMA.md` antes de escribir SQL
- `SECURITY DEFINER` — igual que 052 (justificado: necesita bypasear RLS para leer pipeline de otro usuario)

### PROHIBIDO
- NO eliminar `owned_by_key` del RETURNS TABLE — TypeScript lo usa
- NO cambiar la lógica de retry más allá del ownership
- NO tocar `sandbox/invoke` ni otros endpoints
- NO modificar `052_pipeline_step_outputs.sql` — nueva migración 055
- NO hacer `git push`

---

## 7. Rollback

`DROP FUNCTION get_pipeline_for_retry` y re-ejecutar `052_pipeline_step_outputs.sql`. El TypeScript no cambia — no hay rollback de TS necesario.
