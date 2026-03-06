# Story File — WAS-160a: Schema Migration — Dual Registration

> SDD: doc/sdd/047-dual-registration/sdd.md
> Fecha: 2026-03-05
> Branch: feat/047-dual-registration

---

## Goal

Agregar columnas `registration_type` (enum), `token_id`, y `chain_registered_at` a la tabla `agents`. Marcar agentes existentes con `on_chain_registered = true` como `registration_type = 'on_chain'`. Crear RPC function `discover_agents_v2` para discovery con boost on-chain.

## Acceptance Criteria (EARS)

1. WHEN la migration se ejecuta, THE schema SHALL tener el enum `registration_type` con valores `off_chain` y `on_chain`.
2. WHEN la migration se ejecuta, THE tabla agents SHALL tener columnas `registration_type` (default `off_chain`), `token_id` (nullable), `chain_registered_at` (nullable).
3. WHEN la migration se ejecuta, THE agentes existentes con `on_chain_registered = true` SHALL quedar con `registration_type = 'on_chain'`.
4. WHEN se llama `discover_agents_v2`, THE función SHALL retornar agentes activos ordenados con on-chain primero, luego por `total_calls` desc.

## Files to Modify/Create

| # | Archivo | Acción | Qué hacer | Exemplar |
|---|---------|--------|-----------|----------|
| 1 | `supabase/migrations/039_dual_registration.sql` | Crear | Enum + columnas + retrocompat UPDATE + índice + RPC function | `supabase/migrations/037_trending_agents_rpc.sql` |

## Exemplars

### Exemplar 1: Migration con RPC function
**Archivo**: `supabase/migrations/037_trending_agents_rpc.sql`
**Usar para**: Archivo #1
**Patrón clave**:
- `CREATE TYPE ... AS ENUM`
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- `CREATE OR REPLACE FUNCTION ... RETURNS SETOF ... LANGUAGE sql STABLE`
- `CREATE INDEX IF NOT EXISTS`

## Constraint Directives

### OBLIGATORIO
- Nombre de migration: `039_dual_registration.sql`
- `IF NOT EXISTS` en columnas e índices
- `DEFAULT 'off_chain'` en `registration_type`
- UPDATE retrocompat DENTRO de la misma migration
- RPC function `discover_agents_v2` con parámetros `p_category`, `p_max_price`, `p_limit`

### PROHIBIDO
- NO eliminar columna `on_chain_registered` (retrocompat)
- NO modificar otras tablas
- NO crear tablas nuevas
- NO agregar RLS rules en esta migration (agents ya tiene RLS)

## Waves

### Wave 0 (Serial Gate)
- [ ] W0.1: Verificar migration number disponible (039)
- [ ] W0.2: Leer `037_trending_agents_rpc.sql` como exemplar

### Wave 1 (Implementación)
- [ ] W1.1: Crear `039_dual_registration.sql` → Archivo #1 → Exemplar 1

### Wave 2 (Verificación)
- [ ] W2.1: `npx supabase db push` — migration aplica sin errores
- [ ] W2.2: Verificar que agentes existentes con `on_chain_registered = true` tienen `registration_type = 'on_chain'`

### Verificación Incremental

| Wave | Verificación al completar |
|------|--------------------------|
| W0 | Contexto entendido |
| W1 | SQL es sintácticamente correcto |
| W2 | Migration aplicada en Supabase sin errores |

## Out of Scope

- Cambios a TypeScript types (WAS-160b/c)
- Cambios al contrato (WAS-160g)
- Frontend, API routes

## Escalation Rule

> Si algo no está en este Story File, Dev PARA y pregunta a Architect.

---

*Story File generado por NexusAgil — F2.5*
