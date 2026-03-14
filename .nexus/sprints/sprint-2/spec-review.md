# Spec Review — Sprint 2 WasiAI
**Reviewer:** NexusAgile v1.3 — Spec Reviewer  
**Fecha:** 2026-03-13  
**Repo:** `/home/ferdev/.openclaw/workspace/wasiai-v2/`

---

## Tabla Resumen

| Issue | Título | Status | Hallazgos Críticos |
|-------|--------|--------|--------------------|
| WAS-196 | Sandbox opt-in/out | ✅ APROBADO | Route ya tiene la lógica; body de error tiene typo menor (código vs mensaje) |
| WAS-204 | Compose retry from failed step | ✅ APROBADO con obs. | DB_SCHEMA.md incompleto para pipeline_executions — Builder debe leer migration 017 |
| WAS-186 | Agent Key scoping | ✅ APROBADO | DB_SCHEMA.md tiene error: dice `user_id` en agent_keys pero es `owner_id` |
| WAS-187 | Dynamic Discovery en Compose | ✅ APROBADO con obs. | Dependencia dura de WAS-186; `validateSteps()` se modifica en ambos WAS-204 y WAS-187 |
| WAS-200 | Input Schema + validación pre-cobro | ⚠️ BLOQUEANTE MENOR | Migration 055 salta 054; `ajv` no está en package.json |
| WAS-203 | Cloudflare proxy (FAST-FIX) | ✅ APROBADO | `get-client-ip.ts` ya maneja `cf-connecting-ip` correctamente |

---

## Hallazgos Globales

### 🔴 BLOQUEANTE — WAS-200: Numeración de migration

**Problema:** El AC-1 de WAS-200 especifica migration 055, pero la secuencia es:
- 051: WAS-196
- 052: WAS-204
- 053: WAS-186
- 054: **SIN ASIGNAR** ← gap
- 055: WAS-200

**Opciones:**
1. Si 054 está planeada para otro issue → mantener 055
2. Si no existe issue para 054 → usar 054 (el AC tiene un typo)

**Acción:** Product/TL debe confirmar antes de que el Builder ejecute el SDD-200.

---

### 🔴 BLOQUEANTE — WAS-200: `ajv` no instalado

**Problema:** `package.json` no tiene `ajv`. El SDD-200 Wave 2 requiere `ajv` para meta-validación de JSON Schema.

**Acción:** Builder debe ejecutar `npm install ajv ajv-formats` y commitear el cambio de `package.json`/`package-lock.json` antes de implementar `schema-validator.ts`.

---

### 🟡 ADVERTENCIA GLOBAL — DB_SCHEMA.md desactualizado

**Problemas encontrados:**

| Tabla | Error en DB_SCHEMA.md | Realidad |
|-------|----------------------|----------|
| `agent_keys` | Columna `user_id` | Columna real: `owner_id` |
| `pipeline_executions` | Solo muestra 4 columnas (id, key_id, status, created_at) | Migration 017 tiene 10+ columnas: steps_requested, steps_completed, total_cost_usdc, failed_at_step, error_detail, completed_at, etc. |
| `agents` | No muestra `sandbox_enabled` | Migration 051 la agrega (futuro) |
| `agents` | No muestra `input_schema` | Migration 054/055 la agrega (futuro) |
| `agent_keys` | No muestra `allowed_slugs`, `allowed_categories` | Migration 053 las agrega (futuro) |

**Acción:** Actualizar `doc/DB_SCHEMA.md` como parte de este Sprint. Recomiendo agregar una wave de "actualización de docs" al final de cada SDD que modifique el schema.

---

### 🟡 ADVERTENCIA — WAS-196: Body de error inconsistente

El código actual en `sandbox/invoke/route.ts` retorna:
```json
{ "error": "sandbox_disabled", "message": "This agent does not allow sandbox invocations." }
```

El AC-3 requiere:
```json
{ "error": "Sandbox disabled by creator", "code": "sandbox_disabled" }
```

El campo `code` falta y el campo `error` tiene valor diferente. SDD-196 Wave 2 corrige esto.

---

### 🟡 ADVERTENCIA — WAS-187 + WAS-204: Conflicto en validateSteps()

Ambos issues modifican `validateSteps()` en `compose/route.ts`:
- WAS-187 hace `agent_slug` opcional (mutuamente excluyente con `capability`)
- WAS-204 podría tocar validación de steps para soportar `start_from_step`

**Acción:** Si se asignan a builders diferentes, usar feature branches separados y hacer merge coordinado. El merge debe hacer `npx tsc --noEmit` antes de PR.

---

### 🟡 ADVERTENCIA — WAS-187: Dependencia de WAS-186

WAS-187 AC-7 requiere `isAgentInScope()` que se define en WAS-186. Si se desarrollan en paralelo:

**Opción A:** Builder WAS-187 implementa stub temporal de `isAgentInScope` (siempre retorna true) y lo reemplaza cuando WAS-186 mergea.

**Opción B:** WAS-186 se completa primero (bloqueante para WAS-187).

Recomendación: **Opción B** para evitar código muerto en prod.

---

## Checklist de Constraints Críticos

### 0.3a — Hardcodes
- ✅ Ningún SDD introduce hardcodes de IDs, secrets o contratos

### 0.3b — Funciones protegidas
- ✅ Ningún SDD toca `checkIpLimit` (signature intacta)
- ✅ Ningún SDD toca `sandbox/balance/route.ts`
- ✅ Ningún SDD toca authenticated rate limits

### 0.3c — Contratos on-chain
- ✅ Ningún SDD modifica contratos on-chain

### 0.3d — DB Security
| SDD | SECURITY DEFINER + search_path | GRANTs mínimos | RLS activo | SQL injection | RLS bypass |
|-----|-------------------------------|----------------|------------|---------------|------------|
| 196 | N/A (ALTER TABLE) | ✅ | ✅ heredado | ✅ | ✅ |
| 204 | ✅ (RPCs con SET search_path = public) | ✅ service_role only | ✅ heredado | ✅ | ✅ |
| 186 | N/A (ALTER TABLE) | ✅ | ✅ heredado | ✅ | ✅ |
| 187 | N/A (sin migration) | N/A | N/A | ✅ (Supabase client) | ✅ |
| 200 | N/A (ALTER TABLE) | ✅ | ✅ heredado | ✅ | ✅ |
| 203 | N/A (infra) | N/A | N/A | N/A | N/A |

---

## Orden de Ejecución Recomendado

```
Paralelo (independientes):
├── WAS-196 (migration 051 + route fix + UI)
├── WAS-203 (infra only)
└── WAS-186 (migration 053 + scope logic)
    └── WAS-187 (después de WAS-186, migration no necesaria)

Secuencial (dependiente de DB):
WAS-204 (migration 052, puede ir en paralelo con WAS-196/203/186 en DB, 
         pero builder debe coordinar validateSteps() con WAS-187)

WAS-200 (después de confirmar numeración migration; ajv instalado)
```

---

## Verificaciones de Wave 0 completadas

| Archivo | Existe | Notas |
|---------|--------|-------|
| `src/app/api/v1/sandbox/invoke/[slug]/route.ts` | ✅ | Ya tiene lógica WAS-196 parcial |
| `src/app/api/v1/compose/route.ts` | ✅ | 470 líneas, revisado completamente |
| `src/features/agent-api/services/agent-keys.service.ts` | ✅ | Usa `owner_id` (correcto) |
| `src/app/api/v1/agents/register/route.ts` | ✅ | Zod schema listo para extender |
| `src/app/api/v1/agents/[slug]/route.ts` | ✅ | Falta `input_schema` en select |
| `src/lib/get-client-ip.ts` | ✅ | Ya lee `cf-connecting-ip` ✅ |
| `doc/DB_SCHEMA.md` | ✅ | Desactualizado (ver hallazgos) |
| `supabase/migrations/017_pipeline_executions.sql` | ✅ | Revisado, más columnas que las del schema doc |
| `supabase/migrations/050_*.sql` | ✅ | Última migration = 050 |
| `package.json` (ajv) | ❌ | `ajv` NO instalado — requerido por WAS-200 |
