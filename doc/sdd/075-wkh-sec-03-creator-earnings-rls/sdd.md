# SDD #075: [WKH-SEC-03] Cerrar cross-read `authenticated` de earnings/PII de creators con RLS Postgres-level

> SPEC_APPROVED: no
> Fecha: 2026-07-05
> Tipo: security
> SDD_MODE: full
> Branch: fix/075-wkh-sec-03-creator-earnings-rls
> Artefactos: doc/sdd/075-wkh-sec-03-creator-earnings-rls/

---

## 1. Resumen

La policy `profiles_public_read ON creator_profiles FOR SELECT USING (true)` combinada con
el GRANT `SELECT` de columna que `authenticated` conserva sobre **todas** las columnas de
`creator_profiles` permite que cualquier creator logueado (con su propio JWT, vía REST
directo `GET /rest/v1/creator_profiles?select=...`) lea las columnas financieras/PII de
**otros** creators: `total_earnings`, `pending_earnings_usdc`, `account_status`,
`email_domain`. El vector `anon` ya fue cerrado el 2026-07-05 (REVOKE tabla + GRANT solo
columnas públicas). Esta HU cierra el vector `authenticated` restante moviendo esas 4
columnas a una tabla nueva `creator_earnings` protegida por RLS por-fila
(`USING (creator_id = auth.uid())`), dejando `creator_profiles` como catálogo público puro.
`wallet_address` **se queda** en `creator_profiles` (dato on-chain público, DT-3).

Resultado esperado: un `authenticated` no puede leer NI escribir filas de un `creator_id`
distinto al de su JWT; el creator sigue viendo sus propios earnings sin cambios de contrato;
el join público de catálogo y los flujos service_role de settlement siguen intactos; datos
migrados sin pérdida en bdwv y caldz.

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 075 (WKH-SEC-03) |
| **Tipo** | security |
| **SDD_MODE** | full (superficie financiera + RLS + migración en 2 proyectos Supabase) |
| **Objetivo** | Cerrar el cross-read `authenticated` de earnings/PII con aislamiento por-fila real (RLS Postgres-level) |
| **Reglas de negocio** | Creator solo lee/escribe SUS earnings; catálogo público intacto; service_role sigue bypasseando RLS para settlement/admin |
| **Scope IN** | `supabase/migrations/` (tabla + RLS + backfill + trigger + REVOKE), ~13 call sites + 3 RPCs, aplicación en bdwv y caldz, tests |
| **Scope OUT** | Vector `anon` (ya resuelto), otras tablas de auditorías previas, cambios UI/UX, WKH-SEC-02 (repo a2a) |
| **Missing Inputs** | [RESUELTO F2] Estado real de policies/grants verificado (§3.4). [RESUELTO F2] Esquema = tabla `creator_earnings` (DT-1). [RESUELTO F2] Migración online, sin downtime (§4.4) |

### Acceptance Criteria (EARS) — heredados del work item

- **AC-1** (Unwanted): IF un `authenticated` (creator A) hace `GET /rest/v1/creator_earnings?...`
  o `GET /rest/v1/creator_profiles?select=total_earnings,...` filtrando por el `id` de OTRO
  creator (B), THEN the system SHALL devolver 0 filas / 403 / vacío, sin exponer ningún valor de B.
- **AC-2** (Event-driven): WHEN un creator abre su dashboard o llama
  `/api/creator/wallet`, `/api/creator/earnings/voucher`, o ejecuta `linkWallet()`, the system
  SHALL devolver sus propios `pending_earnings_usdc`/`wallet_address`/`account_status`/
  `onboarding_*` sin cambios de comportamiento ni de contrato de respuesta.
- **AC-3** (State-driven): WHILE `creator_profiles` conserva solo columnas de catálogo
  (`id, username, display_name, bio, avatar_url, verified, total_models, created_at`) +
  `wallet_address` + `onboarding_*`, the system SHALL mantener el join
  `creator:creator_profiles(...)` de `getModels/getModelBySlug/getFeaturedModels` y la lectura
  de `wallet_address` en `status/route.ts:144-148` funcionando sin cambios.
- **AC-4** (Ubiquitous): the system SHALL proteger `creator_earnings` con RLS
  `USING (creator_id = auth.uid())` para `authenticated`, de modo que ningún rol público lea/
  escriba filas ajenas; `service_role` sigue bypasseando RLS para settlement/cron/admin.
- **AC-5** (Event-driven): WHEN se aplica la migración, the system SHALL migrar el 100% de
  las filas de las 4 columnas desde `creator_profiles` a `creator_earnings` **en bdwv Y caldz**,
  verificable por conteo de filas y por suma de `pending_earnings_usdc` idéntica antes/después.
- **AC-6** (Ubiquitous): the system SHALL mantener verde la suite existente tras el cambio de
  esquema y las rutas/acciones reconciliadas.

---

## 3. Context Map (Codebase Grounding)

### 3.1 Archivos leídos

| Archivo | Por qué | Patrón / hallazgo |
|---------|---------|-------------------|
| `supabase/migrations/00000000000003_wasiai_core.sql.SKIP:39-81` | Definición de `creator_profiles` + policies | `total_earnings NUMERIC(18,6)`; policies `profiles_public_read USING(true)` + `profiles_owner_manage USING(id=auth.uid())`, ambas `{public}` |
| `supabase/migrations/015_onboarding-fields.sql` | Añade `pending_earnings_usdc` + RPC `increment_pending_earnings` | RPC `(p_user_id UUID, p_amount NUMERIC)` → `UPDATE creator_profiles ... WHERE id=p_user_id` |
| `supabase/migrations/076_add_account_status.sql` | Tipo de `account_status` | ENUM `account_status_enum ('active','pending_review','suspended')`, NOT NULL default `'active'`; índice parcial `WHERE account_status != 'active'` |
| `supabase/migrations/20260625030000_decrement_pending_earnings.sql` | RPC decrement | `decrement_pending_earnings(p_user_id, p_amount)` → `UPDATE creator_profiles` |
| `supabase/migrations/20260625040000_withdraw_record_and_decrement.sql` | RPC withdraw atómico | `record_withdrawal_and_decrement(p_user_id, p_tx_hash, p_amount)` → `UPDATE creator_profiles.pending_earnings_usdc` (línea 43-45) |
| `supabase/migrations/20260625050000_voucher_insert_if_none_pending.sql` | RPC voucher | **NO toca las 4 columnas** (opera sobre `creator_withdrawal_vouchers`) → fuera de scope |
| `supabase/migrations/00000000000004_wasiai_triggers.sql:1-34` | Trigger de alta de creator | `handle_new_user()` INSERTa `creator_profiles(id, username, display_name, avatar_url)` en signup → necesita fila espejo en `creator_earnings` |
| `src/app/api/admin/settlement/route.ts:264-283` | Escritura pending (settlement) | service_role: `rpc('increment_pending_earnings', {p_wallet, p_amount})` **[BUG latente, §3.5]** + fallback `UPDATE creator_profiles` |
| `src/lib/settlement/runSettlement.ts:180,267` | Escritura pending (cron) | service_role: `rpc('increment_pending_earnings', {p_user_id, p_amount})` (nombre de arg correcto) x2 |
| `src/lib/invoke/handleInvoke.ts:669` | Escritura pending (invoke) | service_role: `rpc('increment_pending_earnings', {p_user_id, p_amount})` |
| `src/lib/settlement/immediateSettlement.ts:41,72,170` | Zero-out pending | service_role: `UPDATE creator_profiles SET pending_earnings_usdc = 0` x3 |
| `src/app/api/creator/withdraw/route.ts:144` | Withdraw | service_role: `rpc('record_withdrawal_and_decrement', {...})` |
| `src/app/api/creator/analytics/route.ts:56-60,92,228` | Read pending | service_role: `select('id, pending_earnings_usdc, wallet_address')` |
| `src/app/api/v1/agents/register/route.ts:117,167,172,209` | Read/write email_domain + account_status | service_role: `.eq('email_domain', domain)` (anti-abuso) + INSERT con `email_domain`, `account_status` |
| `src/app/api/creator/agents/[slug]/status/route.ts:82-86,144-148` | Read account_status (service_role) + wallet_address (authenticated) | `serviceClient.select('account_status')`; `supabase.select('wallet_address')` (wallet se queda) |
| `src/app/[locale]/creator/dashboard/_components/EarningsSection.tsx:23-27` | Self-read authenticated | `createClient().select('wallet_address, pending_earnings_usdc').eq('id', userId)` |
| `src/app/[locale]/creator/dashboard/page.tsx:78-82` | Self-read authenticated | `select('onboarding_completed, onboarding_step, pending_earnings_usdc, wallet_address').eq('id', user.id)` |
| `src/app/api/creator/wallet/route.ts:28-32,45-48` | Self-read + update wallet | `select('wallet_address, pending_earnings_usdc').eq('id', user.id)` |
| `src/app/api/creator/earnings/voucher/route.ts:35-39` | Self-read authenticated | `select('wallet_address, pending_earnings_usdc').eq('id', user.id)` |
| `src/actions/wallet.ts:52-71` | Self-read + update | `select('id, wallet_address, pending_earnings_usdc').eq('id', user.id)` |
| `src/features/models/services/models.service.ts` | Join público (no tocar) | `creator:creator_profiles(id, username, display_name, avatar_url, verified[, bio])` — solo columnas públicas |
| `src/features/models/types/models.types.ts:82-89` | Tipo `CreatorProfile` | Incluye `total_earnings: number` → actualizar tipo |
| `src/components/PendingEarningsBanner.tsx` | Consumidor | Recibe el valor por **prop** (sin query propia) → sin cambio de datos |

### 3.2 Exemplars verificados (Glob confirmados)

| Para crear/modificar | Seguir patrón de | Razón |
|----------------------|------------------|-------|
| Migración tabla+RLS+REVOKE | `supabase/migrations/20260702020000_fix_permissive_rls_escrow_ratings.sql` | Patrón `BEGIN;...COMMIT;` + `ALTER POLICY ... TO service_role` + `REVOKE ... FROM anon, authenticated` idempotente |
| REVOKE explícito por rol | `supabase/migrations/20260702010000_fix_revoke_supabase_default_acl.sql` | Justifica CD-2: `REVOKE ... FROM PUBLIC, anon, authenticated` + re-`GRANT ... TO service_role` |
| RPC SECURITY DEFINER + ownership guard | `supabase/migrations/015` (increment) + guard live en DB (§3.5) | `IF auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN RAISE EXCEPTION` |
| Test de concurrencia/seguridad (vitest) | `src/app/api/creator/earnings/voucher/__tests__/voucher-concurrency.test.ts` | Estructura vitest `vi.hoisted()` (para tests unit) — **pero AC-1 requiere test de DB real, §7** |
| Enum compartido preexistente | `account_status_enum` (076) | `creator_earnings.account_status` referencia el ENUM existente, no lo recrea |

### 3.3 Estado de BD relevante (verificado, NO asumido — §3.4)

| Tabla / objeto | Existe | Nota |
|----------------|--------|------|
| `creator_profiles` | Sí (bdwv + caldz) | RLS ON; policies `profiles_public_read`, `profiles_owner_manage` |
| `creator_earnings` | **No** | La crea esta HU |
| `account_status_enum` | Sí (ambos) | Reutilizable directamente |
| RPCs `increment_/decrement_pending_earnings`, `record_withdrawal_and_decrement` | Sí (ambos) | Re-apuntar a `creator_earnings` |
| Trigger `on_auth_user_created` → `handle_new_user()` | Sí | Extender o añadir trigger espejo en `creator_earnings` |

### 3.4 Estado REAL de policies + grants (verificado 2026-07-05 vía Management API, ambos proyectos)

Proyectos: **bdwv** = `bdwvrwzvsldephfibmuu` (name "WasiAI", staging/testnet) · **caldz** =
`caldzjhjgctpgodldqav` (name "wasiai-prod", mainnet).

**Policies sobre `creator_profiles` (idénticas en ambos):**
- `profiles_public_read` — `FOR SELECT`, roles `{public}`, `USING (true)`
- `profiles_owner_manage` — `FOR ALL`, roles `{public}`, `USING (id = auth.uid())`

**Grants de columna (confirmado el fix `anon` de hoy YA aplicado en ambos):**
- `anon`: **NO** tiene `SELECT` a nivel tabla; `SELECT` de columna solo sobre las públicas
  (`id, username, display_name, bio, avatar_url, verified, total_models, created_at, wallet_address`).
  **Sin** `SELECT` sobre `total_earnings/pending_earnings_usdc/account_status/email_domain`. ✅ cerrado.
- `authenticated`: **SÍ** tiene `SELECT` a nivel tabla + `SELECT` de columna sobre **TODAS**
  las columnas, incluidas `total_earnings, pending_earnings_usdc, account_status, email_domain`.
  ⛔ **Este es el vector que esta HU cierra.**

**Tipos exactos de las 4 columnas a mover (para mirrorear sin drift):**
| Columna | Tipo | Nullable | Default |
|---------|------|----------|---------|
| `total_earnings` | `numeric(18,6)` | YES | `0` |
| `pending_earnings_usdc` | `numeric(20,6)` | NO | `0` |
| `account_status` | `account_status_enum` | NO | `'active'` |
| `email_domain` | `text` | YES | `null` |

**Baseline de datos para paridad AC-5 (verificado hoy):**
| Proyecto | `count(*)` | `sum(pending_earnings_usdc)` | `sum(total_earnings)` |
|----------|-----------|------------------------------|------------------------|
| bdwv | 7 | 1.477000 | 4281.250000 |
| caldz | 41 | 5.660800 | 0.000000 |

> Observación out-of-scope (informar, no arreglar aquí): `anon` conserva grants de columna
> `INSERT/UPDATE` sobre columnas de `creator_profiles`, pero las escrituras quedan bloqueadas
> por `profiles_owner_manage USING(id=auth.uid())` (anon → `auth.uid()` NULL). No es parte de
> este hallazgo; documentado para una futura limpieza de write-grants de `anon`.

### 3.5 Hallazgo crítico: superficie MÁS amplia que la del work item + bug latente

1. **Superficie real:** el work item listó "6 call sites + 1 RPC". El grounding (grep sobre
   `pending_earnings_usdc|total_earnings|account_status|email_domain`) encontró **~13 archivos
   + 3 RPCs** que tocan las 4 columnas (tabla §3.1). Mover las columnas obliga a re-apuntar
   **todos** — un writer olvidado produce **drift financiero silencioso**. El RPC
   `insert_voucher_if_none_pending` **NO** toca estas columnas (excluido).
2. **Bug latente en settlement:** `admin/settlement/route.ts:265` llama
   `rpc('increment_pending_earnings', { p_wallet: wallet, p_amount })` — pero la firma real es
   `(p_user_id UUID, p_amount)`. El nombre de arg `p_wallet` no existe → la llamada RPC
   **siempre falla** y hoy solo corre el fallback (`UPDATE creator_profiles ... WHERE wallet_address`).
   Al re-apuntar, el Dev DEBE corregir esto: resolver `id` por `wallet_address` sobre
   `creator_profiles` y llamar el RPC con `p_user_id`, o re-apuntar el fallback a
   `creator_earnings`. (Corregir el nombre del arg es una mejora recomendada, no scope creep.)

---

## 4. Diseño Técnico

### 4.1 Archivos a crear/modificar

| Archivo | Acción | Qué hace | Exemplar |
|---------|--------|----------|----------|
| `supabase/migrations/<ts>_creator_earnings_table.sql` | Crear | **Fase A:** CREATE `creator_earnings` + backfill + RLS + policies + grants + trigger + re-apuntar 3 RPCs | `20260702020000_...escrow_ratings.sql`, `015`, `20260625030000`, `20260625040000` |
| `supabase/migrations/<ts+1>_revoke_legacy_earnings_columns.sql` | Crear | **Fase B:** `REVOKE SELECT` (+INSERT/UPDATE) de las 4 columnas legacy en `creator_profiles` de `anon, authenticated` | `20260702010000_...default_acl.sql`, `20260702020000_...escrow_ratings.sql` |
| `src/app/[locale]/creator/dashboard/_components/EarningsSection.tsx` | Modificar | `pending_earnings_usdc` desde `creator_earnings` (RLS self); `wallet_address` sigue en `creator_profiles` | — |
| `src/app/[locale]/creator/dashboard/page.tsx` | Modificar | `pending_earnings_usdc` desde `creator_earnings`; `onboarding_*`+`wallet_address` siguen en `creator_profiles` | — |
| `src/app/api/creator/wallet/route.ts` | Modificar | Lectura de `pending_earnings_usdc` (bloqueo por pending) → `creator_earnings` | — |
| `src/app/api/creator/earnings/voucher/route.ts` | Modificar | Lectura de `pending_earnings_usdc` → `creator_earnings` | — |
| `src/actions/wallet.ts` | Modificar | Lectura de `pending_earnings_usdc` (bloqueo cambio wallet) → `creator_earnings` | — |
| `src/app/api/creator/analytics/route.ts` | Modificar | service_role: `pending_earnings_usdc` → `creator_earnings` (join o 2ª query) | — |
| `src/app/api/creator/agents/[slug]/status/route.ts` | Modificar | service_role: `account_status` → `creator_earnings`; `wallet_address` sin cambio | — |
| `src/app/api/v1/agents/register/route.ts` | Modificar | `email_domain`/`account_status`: escribir en `creator_earnings`; lookup anti-abuso `.eq('email_domain', ...)` → `creator_earnings` | — |
| `src/app/api/admin/settlement/route.ts` | Modificar | RPC increment (fix arg §3.5) + fallback → `creator_earnings` | — |
| `src/lib/settlement/runSettlement.ts` | Modificar | RPCs increment (firma sin cambio; solo verifica que apuntan a la nueva tabla vía RPC) | — |
| `src/lib/settlement/immediateSettlement.ts` | Modificar | 3x `UPDATE ... pending_earnings_usdc = 0` → `creator_earnings` | — |
| `src/lib/invoke/handleInvoke.ts` | Modificar | RPC increment (sin cambio de call si RPC re-apunta internamente) — verificar | — |
| `src/app/api/creator/withdraw/route.ts` | Modificar | RPC `record_withdrawal_and_decrement` (sin cambio de call si RPC re-apunta internamente) — verificar | — |
| `src/features/models/types/models.types.ts` | Modificar | Sacar `total_earnings` de `CreatorProfile`; añadir tipo `CreatorEarnings` si aplica | — |
| Tests existentes que mockean estas queries/RPCs | Modificar | `settle-key-batches.test.ts`, `analytics.test.ts`, `withdraw-decrement.test.ts`, `voucher-concurrency.test.ts`, `fee-math.test.ts` — actualizar mocks al nuevo esquema | — |
| `src/**/__tests__/creator-earnings-rls.integration.test.ts` (nuevo) | Crear | AC-1/AC-2/AC-4 contra DB real (§7) | `voucher-concurrency.test.ts` (estructura) |

> **Nota RPC vs call site:** los 3 RPCs (`increment_/decrement_pending_earnings`,
> `record_withdrawal_and_decrement`) se re-apuntan **dentro de la migración** (redefinición del
> cuerpo `UPDATE creator_earnings ... WHERE creator_id = p_user_id`), manteniendo la **firma
> idéntica**. Por eso los call sites que solo invocan el RPC con los mismos args
> (`runSettlement`, `handleInvoke`, `withdraw`) **no cambian su llamada** — pero el Dev DEBE
> verificarlo call-por-call y no asumir.

### 4.2 Modelo de datos — tabla `creator_earnings`

```
creator_earnings
  creator_id            UUID PRIMARY KEY REFERENCES creator_profiles(id) ON DELETE CASCADE
  total_earnings        NUMERIC(18,6)          DEFAULT 0            -- nullable (mirror)
  pending_earnings_usdc NUMERIC(20,6) NOT NULL DEFAULT 0
  account_status        account_status_enum NOT NULL DEFAULT 'active'   -- reusar ENUM existente
  email_domain          TEXT                                        -- nullable
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
```

- **RLS:** `ENABLE ROW LEVEL SECURITY`.
- **Policy self-read:** `FOR SELECT TO authenticated USING (creator_id = auth.uid())`.
- **Policy service:** `FOR ALL TO service_role USING (true) WITH CHECK (true)` (defensa
  explícita además del BYPASSRLS de service_role; evita el bug de policy-a-PUBLIC de
  `20260702020000`).
- **Sin acceso `anon`:** no crear policy para `anon`; REVOKE cualquier grant de columna/tabla
  a `anon` (CD-2).
- **Grants:** `GRANT SELECT ON creator_earnings TO authenticated` (la policy lo restringe a la
  propia fila); `GRANT ALL ON creator_earnings TO service_role`; **nada** a `anon`. Escrituras
  de `authenticated` NO se otorgan (writes solo vía RPC service-definer / service_role).
- **Índice:** replicar el índice parcial de `account_status` (`WHERE account_status != 'active'`)
  si hay consultas por estado; PK cubre lookups por `creator_id`.
- **Trigger de alta:** `AFTER INSERT ON creator_profiles FOR EACH ROW → INSERT INTO
  creator_earnings(creator_id) VALUES (NEW.id) ON CONFLICT DO NOTHING`. Cubre TODOS los paths
  de alta (signup `handle_new_user`, `ensureCreatorProfile`, `v1/agents/register`).
- **Backfill:** `INSERT INTO creator_earnings (creator_id, total_earnings, pending_earnings_usdc,
  account_status, email_domain) SELECT id, total_earnings, pending_earnings_usdc, account_status,
  email_domain FROM creator_profiles ON CONFLICT (creator_id) DO NOTHING`.

### 4.3 Decisión de esquema — DT-1 (elegida y justificada)

**DECISIÓN: Opción (a) — tabla nueva `creator_earnings` con RLS `USING(creator_id = auth.uid())`
como ÚNICA fuente de verdad de las 4 columnas.** Recomendada sobre (b).

**Por qué (a) y no (b) "REVOKE authenticated + columnas en creator_profiles + vista/RPC self-read":**

1. **La única columna con self-read `authenticated` legítimo es `pending_earnings_usdc`**
   (`total_earnings`, `account_status`, `email_domain` solo se acceden vía service_role —
   verificado §3.1). Un GRANT de columna **no es row-scoped**: es imposible expresar "SELECT
   `pending_earnings_usdc` solo de mi propia fila" con privilegios de columna. Eso exige RLS,
   y RLS exige una tabla con owner por-fila → exactamente `creator_earnings`. La opción (b)
   obligaría a una vista security-definer o a mover los 5 self-reads a service_role +
   ownership app-layer: más código y más frágil que una policy de una línea.
2. **Footgun de default-ACL (CD-2):** este proyecto tiene `ALTER DEFAULT PRIVILEGES` que
   re-otorga permisos explícitos a `anon`/`authenticated` (bit por el que fallaron
   `20260701000000` y forzaron `20260702010000`). Un esquema basado en GRANT/REVOKE de columna
   sobre `creator_profiles` es intrínsecamente más quebradizo ante nuevas columnas/re-grants
   que una garantía **estructural** por RLS sobre una tabla dedicada.
3. **AC-3 más limpio:** `creator_profiles` queda como catálogo público puro; una sola tabla
   privada concentra financiero+PII. Coincide con AC-4 y con el framing del work item (menor
   sorpresa para el reviewer).
4. **Garantía estructural para AC-1:** el cross-read se vuelve **imposible por construcción**
   (filtro de fila RLS), no por privilegio de columna.

**Costo asumido de (a):** re-apuntar `account_status`/`email_domain` en `register`/`status`/
`analytics` (mecánico, todo service_role, sin sutileza RLS) + split del INSERT de `register`.
Se documenta como aceptable.

**Alternativa considerada y rechazada (híbrida):** mover solo `pending_earnings_usdc` a
`creator_earnings` y dejar las otras 3 en `creator_profiles` con REVOKE-in-place. Rechazada:
dos mecanismos = más carga cognitiva y las 3 columnas quedarían bajo el footgun de default-ACL
en vez de RLS-by-construction. `(a)` es más uniforme y robusto.

### 4.4 DT-2 — Migración transaccional reversible + secuencia (bdwv-first, online)

- **Transaccional:** `BEGIN; ... COMMIT;` por migración (patrón `20260702020000`).
- **Idempotente (CD-3):** `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
  `INSERT ... ON CONFLICT DO NOTHING`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS`
  antes de `CREATE TRIGGER`, `REVOKE`/`GRANT` (idempotentes por naturaleza),
  `CREATE POLICY` guardado con `DROP POLICY IF EXISTS` previo.
- **Reversible (no destructivo):** esta HU **NO hace `DROP COLUMN`** sobre `creator_profiles`.
  Las 4 columnas legacy quedan físicamente (inertes tras el cutover) como red de rollback; el
  `DROP` definitivo se difiere a una HU de limpieza posterior una vez soakeado. Rollback =
  revertir código + re-`GRANT SELECT` a `authenticated` (Fase B es re-aplicable a la inversa).
- **Online / sin downtime (Missing Input resuelto):** volumen bajo (7/41 filas), escritura de
  earnings vía cron (no realtime). Secuencia sin ventana de datos incorrectos:
  1. **Fase A** (migración additiva): crea tabla + backfill + RLS + trigger + re-apunta RPCs.
     Tras Fase A, los RPCs escriben `creator_earnings`. El código viejo aún lee
     `creator_profiles` (columnas aún presentes).
  2. **Cutover de código** (W1): se despliega el código que lee/escribe `creator_earnings`.
  3. **Fase B** (REVOKE): recién **después** del cutover, revoca `SELECT` de `authenticated`
     sobre las 4 columnas legacy. (Revocar antes rompería el código viejo desplegado.)
  - **Ventana de consistencia:** entre Fase A y el deploy de W1 los RPCs ya escriben la tabla
    nueva mientras el código viejo lee la vieja (frozen). Para **cero staleness** en mainnet, el
    Dev PUEDE hacer que los RPCs de Fase A hagan **dual-write** (actualizar AMBAS: columna legacy
    y `creator_earnings`) y simplificarlos a single-write en Fase B. Dado el bajo volumen y que
    settlement es cron, el acoplamiento estrecho A→deploy sin dual-write es **aceptable**; el
    dual-write es un **hardening opcional** recomendado para mainnet. Decisión final a validar
    en SPEC_APPROVED / por Adversary.
- **Orden de aplicación (CD-1):** aplicar Fase A + Fase B a **bdwv primero**, validar
  (paridad + tests AC-1/AC-5), y **recién después** replicar en **caldz**. Nunca simultáneo ni
  mainnet-first. Aplicación a caldz = paso de deploy gateado por humano (checklist de CLAUDE.md).
- **Checks de paridad (AC-5), correr antes y después del backfill en cada DB:**
  ```
  -- Antes (creator_profiles):  SELECT count(*), sum(pending_earnings_usdc), sum(total_earnings) FROM creator_profiles;
  -- Después (creator_earnings): SELECT count(*), sum(pending_earnings_usdc), sum(total_earnings) FROM creator_earnings;
  -- Diff (debe ser 0 filas):
  SELECT p.id FROM creator_profiles p LEFT JOIN creator_earnings e ON e.creator_id = p.id
    WHERE e.creator_id IS NULL
       OR e.pending_earnings_usdc IS DISTINCT FROM p.pending_earnings_usdc
       OR e.total_earnings       IS DISTINCT FROM p.total_earnings
       OR e.account_status       IS DISTINCT FROM p.account_status
       OR e.email_domain         IS DISTINCT FROM p.email_domain;
  ```
  Valores esperados: bdwv `7 / 1.477000 / 4281.250000`; caldz `41 / 5.660800 / 0.000000`.

### 4.5 Reconciliación de los call sites (DT + CD-4: sin cambiar contrato JSON)

**Reads `authenticated` (RLS self-read) — patrón:** cambiar `.from('creator_profiles')
.select('...pending_earnings_usdc...').eq('id', userId)` por, o bien
(preferido, explícito) una 2ª query `.from('creator_earnings').select('pending_earnings_usdc')
.eq('creator_id', userId).maybeSingle()`, o bien un embed PostgREST
`.from('creator_profiles').select('wallet_address, creator_earnings(pending_earnings_usdc)')
.eq('id', userId)` (aceptable si se declara la FK). Las columnas que **se quedan**
(`wallet_address`, `onboarding_*`) siguen leyéndose de `creator_profiles`. El valor consumido
(`Number(pending)`) y el JSON de respuesta NO cambian (CD-4).

| Call site | Antes | Después |
|-----------|-------|---------|
| `EarningsSection.tsx` | `creator_profiles.select('wallet_address, pending_earnings_usdc')` | `wallet_address` de profiles + `pending_earnings_usdc` de `creator_earnings` (self) |
| `dashboard/page.tsx` | `select('onboarding_*, pending_earnings_usdc, wallet_address')` | `onboarding_*`+`wallet_address` de profiles + pending de `creator_earnings` |
| `api/creator/wallet/route.ts` | `select('wallet_address, pending_earnings_usdc')` (bloqueo) | idem split; lógica de bloqueo y respuesta `{ok}` sin cambio |
| `api/creator/earnings/voucher/route.ts` | `select('wallet_address, pending_earnings_usdc')` | idem split; voucher payload sin cambio (CD-4) |
| `src/actions/wallet.ts` | `select('id, wallet_address, pending_earnings_usdc')` | idem split; return `{success}` sin cambio |
| `api/creator/analytics/route.ts` (service_role) | `select('id, pending_earnings_usdc, wallet_address')` | pending de `creator_earnings`; respuesta `pendingEarningsUsdc` sin cambio |
| `api/creator/agents/[slug]/status/route.ts` (service_role) | `serviceClient.select('account_status')` | `account_status` de `creator_earnings`; `wallet_address` (authenticated) sin cambio |
| `api/v1/agents/register/route.ts` (service_role) | INSERT `email_domain`,`account_status` + `.eq('email_domain', domain)` | INSERT catalog en profiles (trigger crea fila earnings) → UPDATE `creator_earnings` SET email_domain/account_status; lookup anti-abuso `.eq('email_domain', ...)` sobre `creator_earnings` |

**Writes (RPCs re-apuntados en la migración, firma intacta):**
- `increment_pending_earnings(p_user_id, p_amount)` → `UPDATE creator_earnings SET
  pending_earnings_usdc = pending_earnings_usdc + p_amount WHERE creator_id = p_user_id`
  (conservar guard `IF auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN RAISE`).
- `decrement_pending_earnings(p_user_id, p_amount)` → idem con `GREATEST(...-p_amount, 0)`.
- `record_withdrawal_and_decrement(...)` → el `UPDATE creator_profiles` interno (línea 43-45)
  pasa a `UPDATE creator_earnings ... WHERE creator_id = p_user_id`; el INSERT en
  `creator_withdrawals` no cambia.
- Re-`GRANT EXECUTE` de los 3 RPCs a `service_role`; `REVOKE ... FROM anon, authenticated`
  (CD-2, patrón `20260702010000`).
- `admin/settlement/route.ts:265` (fix §3.5) + `immediateSettlement.ts` (3x UPDATE directo) →
  `creator_earnings`.

### 4.6 Flujo principal (Happy Path — creator ve sus earnings)

1. Creator autenticado abre `/creator/dashboard`.
2. `createClient()` (JWT del caller) consulta `creator_earnings` filtrando `creator_id = auth.uid()`.
3. RLS devuelve **solo** su propia fila → `pending_earnings_usdc` propio; `wallet_address` y
   `onboarding_*` desde `creator_profiles`.
4. Resultado: dashboard idéntico al actual, contrato de datos sin cambios.

### 4.7 Flujo de error / ataque (AC-1)

1. Creator A autenticado intenta `GET /rest/v1/creator_earnings?select=*&creator_id=eq.<B>`.
2. RLS `USING(creator_id = auth.uid())` filtra → **0 filas** (no error, sin datos de B).
3. Intento alternativo `GET /rest/v1/creator_profiles?select=pending_earnings_usdc,...&id=eq.<B>`
   → tras Fase B, `authenticated` no tiene `SELECT` sobre esas columnas → PostgREST **403
   "permission denied for column"** / las omite en `select=*`. Sin exposición de B.

---

## 5. Constraint Directives (Anti-Alucinación)

### Heredados del work item
- **CD-1**: OBLIGATORIO aplicar la migración en **bdwv primero**, validar, y recién después en
  **caldz**. Nunca simultáneo ni mainnet-first.
- **CD-2**: PROHIBIDO usar `REVOKE ... FROM PUBLIC` como única defensa. Revocar explícito de
  `anon, authenticated` por nombre (y `PUBLIC` además si aplica). El default-ACL de Supabase
  re-otorga a `anon`/`authenticated` independiente de `PUBLIC`.
- **CD-3**: OBLIGATORIO que toda migración sea idempotente/re-aplicable (`IF NOT EXISTS`,
  `ON CONFLICT DO NOTHING`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS` previo, etc.).
- **CD-4**: PROHIBIDO cambiar el contrato de respuesta JSON de los endpoints/server components
  afectados (mismos nombres de campo, mismos tipos).
- **CD-5**: OBLIGATORIO cubrir AC-1 con un test **automatizado contra DB real** (dos
  `authenticated` reales/simulados, uno leyendo columnas del otro → 0 filas), con evidencia
  archivo:línea. "Verificado manualmente" NO es evidencia válida.

### Nuevos (detectados en F2)
- **CD-6**: OBLIGATORIO re-apuntar **TODOS** los sitios de la tabla §3.1 (≥13 archivos + 3 RPCs),
  no solo los 6 del work item. Antes de cerrar W1, correr
  `grep -rn 'pending_earnings_usdc\|total_earnings\|account_status\|email_domain'` sobre `src/`
  y `supabase/migrations/` y confirmar que **ningún** reader/writer productivo apunta a las
  columnas legacy de `creator_profiles`. Un writer olvidado = drift financiero silencioso.
- **CD-7**: OBLIGATORIO mantener la **firma exacta** de los 3 RPCs (`p_user_id UUID, p_amount
  NUMERIC` / `+ p_tx_hash TEXT`) al re-apuntar el cuerpo; PROHIBIDO cambiar nombres/orden de
  params (rompe los call sites que invocan por nombre). El fix del bug §3.5 se hace en el
  **call site** (`settlement/route.ts`), no en la firma del RPC.
- **CD-8**: OBLIGATORIO conservar el ownership guard `IF auth.uid() IS NOT NULL AND p_user_id
  <> auth.uid() THEN RAISE EXCEPTION 'ownership mismatch'` en `increment_pending_earnings`
  (defensa en profundidad ya viva en DB).
- **CD-9**: `wallet_address` NO se mueve (DT-3). PROHIBIDO tocar su lectura en
  `status/route.ts:144-148`, el join de catálogo, o `models.service.ts`.
- **CD-10** (de auto-blindaje WAS-V2-INT / WKH-66): antes de tocar los tests que mockean estos
  RPCs/queries, correr `grep 'toHaveBeenCalledWith\|toHaveBeenNthCalledWith'` en los `__tests__`
  afectados y ajustar args/objetos de mock. Cambiar un arg de RPC o una query desincroniza
  aserciones existentes aunque el valor sea equivalente.
- **CD-11** (de auto-blindaje WAS-V2-2): Done de F3 incluye `tsc --noEmit && npm run lint &&
  npm test` (los tres). `eslint --max-warnings 0` falla en warnings que TS no ve.
- **CD-12**: PROHIBIDO `DROP COLUMN` sobre `creator_profiles` en esta HU (reversibilidad DT-2).
  El drop definitivo es una HU de limpieza posterior.

### PROHIBIDO (general)
- NO agregar dependencias nuevas.
- NO crear patrones distintos a los exemplars (§3.2).
- NO modificar archivos fuera de Scope IN.
- NO aplicar NADA a caldz antes de validar bdwv (CD-1).
- NO recrear `account_status_enum` (ya existe; reutilizar).

## 6. Scope

**IN:** 2 migraciones (tabla+RLS+backfill+trigger+RPCs re-apuntados; REVOKE legacy),
reconciliación de ~13 call sites + 3 RPCs, tipo TS, tests (unit ajustados + integración RLS),
aplicación bdwv→caldz.

**OUT:** vector `anon` (resuelto), `DROP COLUMN` legacy (HU posterior), otras tablas de
auditorías previas, cambios UI/UX, WKH-SEC-02, write-grants residuales de `anon` (§3.4 nota),
cambio de firma de RPCs.

## 7. Plan de Tests

| Test | AC | Wave | Framework | Qué prueba |
|------|----|----|-----------|------------|
| `creator-earnings-rls.integration.test.ts` — cross-read | **AC-1** | W2 | vitest + **DB real** | Cliente `authenticated` de creator A consulta `creator_earnings` por `creator_id` de B → `data.length === 0`, sin valores de B. También `creator_profiles?select=pending_earnings_usdc` como A sobre B → 403/omitido |
| idem — self-read | AC-2 | W2 | vitest + DB real | Cliente A consulta su propio `creator_earnings` → 1 fila con sus valores |
| idem — write ajena bloqueada | AC-4 | W2 | vitest + DB real | Cliente A intenta `INSERT/UPDATE creator_earnings` con `creator_id` de B → denegado por RLS |
| `settle-key-batches.test.ts` (mod) | AC-6 | W1 | vitest (mock) | Mock del RPC increment con nuevos args/tabla; ver CD-10 |
| `analytics.test.ts`, `withdraw-decrement.test.ts`, `voucher-concurrency.test.ts`, `fee-math.test.ts` (mod) | AC-6 | W1 | vitest (mock) | Actualizar mocks al nuevo esquema/queries |
| Parity script (SQL, §4.4) | AC-5 | W0/W3 | Management API | `count`/`sum` pre-post backfill idénticos en bdwv y caldz |

**Diseño AC-1 automatizado (CD-5) — sin credenciales reales de dos creators:**
La suite existente **mockea** Supabase (`vi.hoisted()`), lo que **no puede** probar RLS (un
mock nunca ejerce la policy — lección auto-blindaje WAS-V2-2: mockear al boundary oculta el
comportamiento real). El test de AC-1 DEBE correr contra un Postgres real con RLS:
- Preferido: `supabase start` local (Postgres con las migraciones aplicadas) **o** las dos
  instancias de test con 2 creators sembrados.
- Obtener 2 JWTs `authenticated` distintos: (a) `auth.admin.createUser()` (service_role) para
  crear 2 usuarios y `signInWithPassword` para tokens reales; o (b) firmar HS256 con
  `SUPABASE_JWT_SECRET` (`{ sub: <creatorId>, role: 'authenticated' }`). **Nota:** el `.env`
  actual expone `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` pero **no**
  `SUPABASE_JWT_SECRET` → si se usa (b), añadir `SUPABASE_JWT_SECRET` al entorno de test
  (disponible en Supabase dashboard → API settings). Documentar la vía elegida en el Story File.
- Crear cliente con anon key + `Authorization: Bearer <jwt_A>`; consultar la fila de B;
  assert `[]`. Repetir para el vector legacy sobre `creator_profiles`.

## 8. Waves de Implementación

### Wave 0 (Serial Gate — esquema additivo, bdwv)
- [ ] W0.1: Migración Fase A `<ts>_creator_earnings_table.sql`: `CREATE TABLE IF NOT EXISTS
  creator_earnings` + RLS + policies + grants + índice + trigger `AFTER INSERT ON
  creator_profiles` + backfill `ON CONFLICT DO NOTHING` + redefinir (CREATE OR REPLACE) los 3
  RPCs apuntando a `creator_earnings` (firma intacta CD-7, guard CD-8) + re-GRANT/REVOKE EXECUTE.
  Todo en `BEGIN;...COMMIT;` idempotente (CD-3). Exemplar: `20260702020000`, `015`, `20260625040000`.
- [ ] W0.2: Aplicar a **bdwv**; correr parity (§4.4) → esperar `7 / 1.477000 / 4281.250000` y
  diff 0 filas. Verificación: typecheck del repo (sin cambios de código todavía).

### Wave 1 (Reconciliación de código — paralelizable por grupo)
- [ ] W1.1 (self-reads authenticated): `EarningsSection.tsx`, `dashboard/page.tsx`,
  `wallet/route.ts`, `earnings/voucher/route.ts`, `actions/wallet.ts` → leer pending de
  `creator_earnings` (CD-4, CD-9).
- [ ] W1.2 (service_role reads/writes): `analytics/route.ts`, `status/route.ts`,
  `v1/agents/register/route.ts` (split INSERT + lookup anti-abuso), `admin/settlement/route.ts`
  (fix §3.5 + fallback), `immediateSettlement.ts` (3x).
- [ ] W1.3 (tipos + verificación RPC call sites): `models.types.ts`; verificar que
  `runSettlement.ts`, `handleInvoke.ts`, `withdraw/route.ts` no requieren cambio de call (RPC
  re-apunta internamente) — confirmar, no asumir.
- [ ] W1.4 (tests unit mockeados): actualizar mocks (CD-10). Verificar baseline previo con
  `git stash` si algún fallo parece preexistente (auto-blindaje WKH-66).
- Verificación W1: `tsc --noEmit && npm run lint && npm test` (CD-11).

### Wave 2 (Tests de seguridad + Fase B REVOKE, bdwv)
- [ ] W2.1: Test de integración RLS `creator-earnings-rls.integration.test.ts` (AC-1/AC-2/AC-4)
  contra DB real (§7).
- [ ] W2.2: Migración Fase B `<ts+1>_revoke_legacy_earnings_columns.sql`: `REVOKE SELECT,
  INSERT, UPDATE ON creator_profiles (total_earnings, pending_earnings_usdc, account_status,
  email_domain) FROM anon, authenticated` (CD-2, idempotente). `BEGIN;...COMMIT;`.
- [ ] W2.3: Aplicar Fase B a **bdwv**; correr test AC-1 → verde; suite completa verde (AC-6).

### Wave 3 (Replicación a mainnet — gateada por humano)
- [ ] W3.1: Tras validar bdwv, aplicar Fase A + Fase B a **caldz** (checklist deploy CLAUDE.md).
  Parity caldz → `41 / 5.660800 / 0.000000`, diff 0. (CD-1)

## 9. Dependencias

| Tarea | Depende de | Razón |
|-------|-----------|-------|
| W1 | W0.2 | La tabla debe existir+backfilleada antes de re-apuntar el código |
| W2.2 (REVOKE) | W1 desplegado | Revocar antes del cutover rompería el código viejo (§4.4) |
| W3.1 (caldz) | W2.3 verde en bdwv | CD-1 bdwv-first |

## 10. Riesgos

| Riesgo | Prob. | Impacto | Mitigación |
|--------|-------|---------|------------|
| Writer de las 4 columnas olvidado → drift financiero | M | A | CD-6 grep exhaustivo pre-cutover; parity diff (§4.4); dual-write opcional (§4.4) |
| Bug latente RPC `p_wallet` (§3.5) se propaga | M | M | Fix en call site + test; documentado CD-7 |
| Test AC-1 no ejerce RLS real (mock) | M | A | CD-5 fuerza DB real; §7 detalla JWTs/JWT_SECRET |
| Aserciones `toHaveBeenCalledWith` rotas por nuevos args | A | B | CD-10 grep previo |
| `SUPABASE_JWT_SECRET` ausente en test env | M | M | §7: usar `auth.admin.createUser` o añadir secret al test env |
| Aplicar a caldz antes de validar bdwv | B | A | CD-1; W3 gateada por humano |
| Split INSERT en `register` deja fila earnings incompleta | B | M | Trigger `AFTER INSERT` garantiza la fila; register solo hace UPDATE de email_domain/account_status |

## 11. Missing Inputs

- [x] Estado real policies/grants bdwv+caldz — RESUELTO (§3.4, verificado Management API).
- [x] Esquema final (DT-1) — RESUELTO: tabla `creator_earnings` (§4.3).
- [x] Downtime — RESUELTO: online, sin downtime (§4.4).
- [ ] Vía de JWT para el test AC-1 (`SUPABASE_JWT_SECRET` vs `admin.createUser`) — a fijar en el
  Story File (F2.5); NO bloqueante para SPEC_APPROVED (ambas vías son viables, §7).

## 12. Uncertainty Markers

| Marker | Sección | Descripción | Bloqueante? |
|--------|---------|-------------|-------------|
| [TBD] | 4.4 | Dual-write en RPCs de Fase A (hardening cero-staleness) vs acoplamiento estrecho A→deploy — decidir con Adversary en SPEC_APPROVED | No |
| [TBD] | 7 | Mecanismo exacto de JWT del test AC-1 (secret vs admin API) | No |

> Sin `[NEEDS CLARIFICATION]`. Ambos `[TBD]` son de implementación, no de negocio, y no
> bloquean SPEC_APPROVED.

---

## Readiness Check (F2)

```
[x] Cada AC tiene ≥1 archivo asociado en §4.1 (AC-1/4 → migración+integration test; AC-2/3 → call sites; AC-5 → migración+parity; AC-6 → tests)
[x] Cada archivo en §4.1 tiene Exemplar válido verificado con Glob (§3.2 confirmados en disco)
[x] No hay [NEEDS CLARIFICATION] pendientes (2 [TBD] no bloqueantes, de implementación)
[x] Constraint Directives incluyen ≥3 PROHIBIDO (12 CDs: 5 heredados + 7 nuevos)
[x] Context Map tiene ≥2 archivos leídos (≥22 archivos + 6 migraciones)
[x] Scope IN y OUT explícitos y no ambiguos (§6)
[x] BD: tablas verificadas (creator_earnings NO existe; account_status_enum SÍ; RPCs SÍ; estado grants §3.4)
[x] Happy Path completo (§4.6)
[x] Flujo de error/ataque definido (§4.7, AC-1)
[x] Estado real de DB verificado contra bdwv Y caldz (Missing Input bloqueante resuelto)
[x] Superficie ampliada detectada y acotada (§3.5, CD-6) — 13 archivos + 3 RPCs
```

Todos los checks pasan. SDD listo para clinical review SPEC_APPROVED.

---

*SDD generado por NexusAgil — FULL — F2 · WKH-SEC-03*
