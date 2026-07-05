# Story File — #075: [WKH-SEC-03] Cerrar cross-read `authenticated` de earnings/PII con RLS Postgres-level

> SDD: doc/sdd/075-wkh-sec-03-creator-earnings-rls/sdd.md
> Fecha: 2026-07-05
> Branch: fix/075-wkh-sec-03-creator-earnings-rls
> Repo: wasiai-v2

---

## Goal

Cerrar el vector `authenticated` de cross-read: hoy cualquier creator logueado puede leer
(vía REST directo con su propio JWT) las columnas financieras/PII de **otros** creators
(`total_earnings, pending_earnings_usdc, account_status, email_domain`) porque la policy
`profiles_public_read USING(true)` + el GRANT de columna a `authenticated` no son row-scoped.
La solución: mover esas 4 columnas a una tabla nueva `creator_earnings` protegida por RLS
por-fila (`USING (creator_id = auth.uid())`), reconciliar ~13 call sites + 3 RPCs, y revocar
el acceso legacy. `wallet_address` **se queda** en `creator_profiles` (dato on-chain público,
DT-3). `creator_profiles` queda como catálogo público puro.

---

## Decisiones de orquestador (FIJADAS — no re-abrir)

1. **DUAL-WRITE en RPCs de Fase A**: los 3 RPCs redefinidos en la migración de **Fase A**
   actualizan **AMBAS** tablas (columna legacy en `creator_profiles` Y `creator_earnings`)
   para cero-staleness durante la ventana A→deploy (caldz es mainnet con earnings reales).
   En la migración de **Fase B** se simplifican a **single-write** (solo `creator_earnings`).
   Esto está resuelto: NO es opcional (cierra el `[TBD]` §4.4 del SDD).
2. **JWT del test AC-1**: usar `supabase.auth.admin.createUser()` (service_role) + `signInWithPassword`
   para obtener 2 JWTs `authenticated` reales. **NO** depender de `SUPABASE_JWT_SECRET` (no está en
   el env). Fallback documentado: `supabase start` local si el runner no llega a la instancia.
   Esto cierra el `[TBD]` §7 del SDD.

---

## Reparto de responsabilidades (LEER — crítico)

| Quién | Qué |
|-------|-----|
| **Dev (vos, F3)** | ESCRIBE los 2 archivos `.sql` en `supabase/migrations/` + el código reconciliado + los tests. Corre `tsc/lint/test` local. **NO aplica NADA a la DB.** |
| **Orquestador (post-F3)** | APLICA las migraciones a **bdwv** vía Management API, corre parity SQL, valida. |
| **Humano (gate)** | Autoriza la replicación a **caldz** (mainnet). W3 está GATEADA. |

> El Dev entrega artefactos. El deploy a bdwv y a caldz NO es trabajo del Dev. Si un test de
> integración (AC-1) necesita una DB con las migraciones aplicadas, usar `supabase start` local
> (ver Wave 2), nunca aplicar a bdwv/caldz desde F3.

---

## Acceptance Criteria (EARS) — copiados del SDD aprobado

- **AC-1** (Unwanted): IF un `authenticated` (creator A) hace `GET /rest/v1/creator_earnings?...`
  o `GET /rest/v1/creator_profiles?select=total_earnings,...` filtrando por el `id` de OTRO
  creator (B), THEN the system SHALL devolver 0 filas / 403 / vacío, sin exponer ningún valor de B.
- **AC-2** (Event-driven): WHEN un creator abre su dashboard o llama `/api/creator/wallet`,
  `/api/creator/earnings/voucher`, o ejecuta `linkWallet()`, the system SHALL devolver sus propios
  `pending_earnings_usdc`/`wallet_address`/`account_status`/`onboarding_*` sin cambios de
  comportamiento ni de contrato de respuesta.
- **AC-3** (State-driven): WHILE `creator_profiles` conserva solo columnas de catálogo +
  `wallet_address` + `onboarding_*`, the system SHALL mantener el join `creator:creator_profiles(...)`
  de `getModels/getModelBySlug/getFeaturedModels` y la lectura de `wallet_address` en
  `status/route.ts:144-148` funcionando sin cambios.
- **AC-4** (Ubiquitous): the system SHALL proteger `creator_earnings` con RLS
  `USING (creator_id = auth.uid())` para `authenticated`; `service_role` sigue bypasseando RLS.
- **AC-5** (Event-driven): WHEN se aplica la migración, the system SHALL migrar el 100% de las
  filas de las 4 columnas desde `creator_profiles` a `creator_earnings` en bdwv Y caldz,
  verificable por conteo de filas y suma de `pending_earnings_usdc` idéntica.
- **AC-6** (Ubiquitous): the system SHALL mantener verde la suite existente tras el cambio.

---

## Contratos exactos (INTOCABLES)

### DDL de `creator_earnings` (§4.2 SDD)

```
creator_earnings
  creator_id            UUID PRIMARY KEY REFERENCES creator_profiles(id) ON DELETE CASCADE
  total_earnings        NUMERIC(18,6)          DEFAULT 0            -- nullable (mirror exacto)
  pending_earnings_usdc NUMERIC(20,6) NOT NULL DEFAULT 0
  account_status        account_status_enum NOT NULL DEFAULT 'active'   -- REUSAR ENUM existente, NO recrear
  email_domain          TEXT                                        -- nullable
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
```

Tipos EXACTOS verificados contra la DB (§3.4 SDD) — mirrorear sin drift:
`total_earnings numeric(18,6)` nullable default 0 · `pending_earnings_usdc numeric(20,6)` NOT NULL
default 0 · `account_status account_status_enum` NOT NULL default 'active' · `email_domain text` nullable.

- **RLS**: `ENABLE ROW LEVEL SECURITY`.
- **Policy self-read**: `FOR SELECT TO authenticated USING (creator_id = auth.uid())`.
- **Policy service**: `FOR ALL TO service_role USING (true) WITH CHECK (true)` — **con `TO service_role`
  EXPLÍCITO** (el bug de `20260702020000` fue justamente omitir `TO service_role` → default PUBLIC).
- **Sin policy `anon`.** REVOKE cualquier grant de `anon` (CD-2).
- **Grants**: `GRANT SELECT ON creator_earnings TO authenticated` (la policy lo restringe a su fila);
  `GRANT ALL ON creator_earnings TO service_role`; **nada** a `anon`. NO otorgar INSERT/UPDATE a
  `authenticated` (escrituras solo vía RPC SECURITY DEFINER / service_role).
- **Trigger de alta**: `AFTER INSERT ON creator_profiles FOR EACH ROW → INSERT INTO
  creator_earnings(creator_id) VALUES (NEW.id) ON CONFLICT DO NOTHING`. Cubre TODOS los paths de
  alta (signup `handle_new_user`, `ensureCreatorProfile`, `v1/agents/register`).
- **Backfill**: `INSERT INTO creator_earnings (creator_id, total_earnings, pending_earnings_usdc,
  account_status, email_domain) SELECT id, total_earnings, pending_earnings_usdc, account_status,
  email_domain FROM creator_profiles ON CONFLICT (creator_id) DO NOTHING`.

### Firmas de los 3 RPCs — INTACTAS (CD-7, PROHIBIDO cambiar nombres/orden/tipos de params)

```
increment_pending_earnings(p_user_id UUID, p_amount NUMERIC) RETURNS void
decrement_pending_earnings(p_user_id UUID, p_amount NUMERIC) RETURNS void
record_withdrawal_and_decrement(p_user_id UUID, p_tx_hash TEXT, p_amount NUMERIC) RETURNS BOOLEAN
```

### Ownership guard en `increment_pending_earnings` (CD-8 — OBLIGATORIO conservar)

El guard vive HOY en la DB (aunque la migración 015 del repo NO lo muestra — el repo está
desincronizado del estado real, §3.2/§3.5). Al hacer `CREATE OR REPLACE`, el Dev DEBE incluirlo:

```sql
IF auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN
  RAISE EXCEPTION 'ownership mismatch';
END IF;
```

---

## Files to Modify/Create

| # | Archivo | Acción | Qué hacer | Exemplar |
|---|---------|--------|-----------|----------|
| 1 | `supabase/migrations/<ts>_creator_earnings_table.sql` | Crear | **Fase A**: CREATE tabla + RLS + policies + grants + índice + trigger + backfill + 3 RPCs **DUAL-WRITE** (firma intacta CD-7, guard CD-8). `BEGIN;...COMMIT;` idempotente. | `20260702020000`, `015`, `20260625030000`, `20260625040000` |
| 2 | `supabase/migrations/<ts+1>_revoke_legacy_earnings_columns.sql` | Crear | **Fase B**: 3 RPCs **single-write** (solo `creator_earnings`) + `REVOKE SELECT,INSERT,UPDATE` de las 4 columnas legacy en `creator_profiles` FROM `anon, authenticated`. `BEGIN;...COMMIT;` idempotente. | `20260702010000`, `20260702020000` |
| 3 | `src/app/[locale]/creator/dashboard/_components/EarningsSection.tsx` | Modificar | `pending_earnings_usdc` desde `creator_earnings` (self); `wallet_address` sigue en profiles | §Anti-Hallucination A |
| 4 | `src/app/[locale]/creator/dashboard/page.tsx` | Modificar | `pending_earnings_usdc` desde `creator_earnings`; `onboarding_*`+`wallet_address` siguen en profiles | §Anti-Hallucination B |
| 5 | `src/app/api/creator/wallet/route.ts` | Modificar | Lectura `pending_earnings_usdc` (bloqueo) → `creator_earnings`; respuesta `{ok}` sin cambio | §Anti-Hallucination A |
| 6 | `src/app/api/creator/earnings/voucher/route.ts` | Modificar | Lectura `pending_earnings_usdc` → `creator_earnings`; voucher payload sin cambio | §Anti-Hallucination A |
| 7 | `src/actions/wallet.ts` | Modificar | Lectura `pending_earnings_usdc` (bloqueo cambio wallet) → `creator_earnings` | §Anti-Hallucination C |
| 8 | `src/app/api/creator/analytics/route.ts` | Modificar | service_role: `pending_earnings_usdc` → `creator_earnings` (2ª query o join) | §Anti-Hallucination D |
| 9 | `src/app/api/creator/agents/[slug]/status/route.ts` | Modificar | service_role: `account_status` → `creator_earnings`; `wallet_address` (authenticated) **sin cambio** (CD-9) | §Anti-Hallucination E |
| 10 | `src/app/api/v1/agents/register/route.ts` | Modificar | `email_domain`/`account_status`: escribir en `creator_earnings`; lookup anti-abuso `.eq('email_domain',...)` → `creator_earnings` | §Anti-Hallucination F |
| 11 | `src/app/api/admin/settlement/route.ts` | Modificar | Fix bug `p_wallet`→`p_user_id` (§3.5) + fallback → `creator_earnings` | §Anti-Hallucination G |
| 12 | `src/lib/settlement/runSettlement.ts` | Verificar | Llama RPC `increment_pending_earnings({p_user_id, p_amount})` — call **NO cambia** (RPC re-apunta interno). CONFIRMAR, no asumir. | — |
| 13 | `src/lib/settlement/immediateSettlement.ts` | Modificar | 3x `UPDATE creator_profiles SET pending_earnings_usdc = 0` → `creator_earnings` | §Anti-Hallucination H |
| 14 | `src/lib/invoke/handleInvoke.ts` | Verificar | RPC `increment_pending_earnings` — call **NO cambia**. CONFIRMAR. | — |
| 15 | `src/app/api/creator/withdraw/route.ts` | Verificar | RPC `record_withdrawal_and_decrement` — call **NO cambia**. CONFIRMAR. | — |
| 16 | `src/features/models/types/models.types.ts` | Modificar | Sacar `total_earnings` de `CreatorProfile` (líneas 82-89) | — |
| 17 | `src/**/__tests__/creator-earnings-rls.integration.test.ts` | Crear | AC-1/AC-2/AC-4 contra DB real (`supabase start`) | §Anti-Hallucination I + `voucher-concurrency.test.ts` (estructura) |
| 18 | Tests unit que mockean estas queries/RPCs | Modificar | `settle-key-batches.test.ts`, `analytics.test.ts`, `withdraw-decrement.test.ts`, `voucher-concurrency.test.ts`, `fee-math.test.ts` — ajustar mocks (CD-10) | — |

---

## Anti-Hallucination — snippets exactos (antes → después)

> Reusar EXACTAMENTE estos patrones. Las columnas que **se quedan** (`wallet_address`,
> `onboarding_*`) siguen leyéndose de `creator_profiles`. El valor consumido (`Number(pending)`)
> y el JSON de respuesta NO cambian (CD-4). Patrón preferido: **2ª query explícita** a
> `creator_earnings` con `.eq('creator_id', userId).maybeSingle()`.

### A — Self-read authenticated (EarningsSection.tsx / wallet/route.ts / earnings/voucher/route.ts)

Patrón actual (EarningsSection.tsx:23-27):
```ts
const { data: profile } = await supabase
  .from('creator_profiles')
  .select('wallet_address, pending_earnings_usdc')
  .eq('id', userId)
  .single()
const pendingOnChain = Number(profile?.pending_earnings_usdc ?? 0)
```
Después (split: wallet de profiles + pending de earnings):
```ts
const { data: profile } = await supabase
  .from('creator_profiles')
  .select('wallet_address')
  .eq('id', userId)
  .single()
const { data: earnings } = await supabase
  .from('creator_earnings')
  .select('pending_earnings_usdc')
  .eq('creator_id', userId)
  .maybeSingle()
const pendingOnChain = Number(earnings?.pending_earnings_usdc ?? 0)
```
Aplicar el MISMO split en `wallet/route.ts:28-32` y `earnings/voucher/route.ts:35-39`
(ambos hacen `.select('wallet_address, pending_earnings_usdc').eq('id', user.id)`). Lógica de
bloqueo por pending y el JSON de respuesta quedan idénticos.

### B — dashboard/page.tsx:78-82

Antes:
```ts
const { data: creatorProfile } = await supabase
  .from('creator_profiles')
  .select('onboarding_completed, onboarding_step, pending_earnings_usdc, wallet_address')
  .eq('id', user.id)
  .single()
const pendingEarnings = Number(creatorProfile?.pending_earnings_usdc ?? 0)
```
Después (onboarding_* + wallet_address de profiles; pending de earnings):
```ts
const { data: creatorProfile } = await supabase
  .from('creator_profiles')
  .select('onboarding_completed, onboarding_step, wallet_address')
  .eq('id', user.id)
  .single()
const { data: earnings } = await supabase
  .from('creator_earnings')
  .select('pending_earnings_usdc')
  .eq('creator_id', user.id)
  .maybeSingle()
const pendingEarnings = Number(earnings?.pending_earnings_usdc ?? 0)
```

### C — src/actions/wallet.ts:52-71

Antes: `.from('creator_profiles').select('id, wallet_address, pending_earnings_usdc').eq('id', user.id).maybeSingle()`
usado para: `wallet_address` (comparación new-wallet) + `pending_earnings_usdc` (bloqueo).
Después: mantener la query a `creator_profiles` para `id, wallet_address`; **agregar** 2ª query
a `creator_earnings` para `pending_earnings_usdc` (`.eq('creator_id', user.id).maybeSingle()`).
`const hasPending = Number(earnings?.pending_earnings_usdc ?? 0) > 0`. `return { success: true }` sin cambio.

### D — analytics/route.ts (service_role, §3.1 líneas 56-60,92,228)

`select('id, pending_earnings_usdc, wallet_address')` sobre `creator_profiles` → sacar
`pending_earnings_usdc` de esa query y traerlo con 2ª query a `creator_earnings`
(`.eq('creator_id', <id>)`). Respuesta `pendingEarningsUsdc` sin cambio (CD-4). Es service_role
(bypassa RLS) → filtra por el `id` que ya usa.

### E — status/route.ts (§3.1 líneas 82-86 service_role read account_status; 144-148 authenticated wallet)

- `serviceClient.from('creator_profiles').select('account_status')` (líneas 82-86) →
  `serviceClient.from('creator_earnings').select('account_status').eq('creator_id', <id>)`.
- **PROHIBIDO tocar** la lectura de `wallet_address` en líneas 144-148 (`supabase.from('creator_profiles')
  .select('wallet_address').eq('id', user.id).single()`) — `wallet_address` se queda (CD-9).

### F — v1/agents/register/route.ts (service_role)

Dos cosas (ambas service_role, sin sutileza RLS):
1. **Anti-abuso lookup** (líneas ~114-118): `.from('creator_profiles').select('id',{count}).eq('email_domain', domain).neq('id', userId)`
   → cambiar `.from('creator_profiles')` por `.from('creator_earnings')` y `.neq('id', userId)` por
   `.neq('creator_id', userId)`.
2. **Write de `email_domain`/`account_status`** (`resolveCreatorFromEmail` líneas ~163-175 usa
   `upsert(profilePayload)` con `email_domain` + `account_status` sobre `creator_profiles`; y
   `bootstrapAnonymousCreator` línea ~209 hace `insert(... email_domain, account_status ...)`):
   - El `upsert`/`insert` de catálogo (`id, username, display_name`) se queda en `creator_profiles`.
   - El trigger `AFTER INSERT` crea la fila espejo en `creator_earnings`.
   - Sacar `email_domain` y `account_status` del payload de `creator_profiles` y escribirlos con un
     `UPDATE creator_earnings SET email_domain=..., account_status=... WHERE creator_id = userId`
     (después del upsert de profiles, para que el trigger ya haya creado la fila; ON CONFLICT del
     trigger es DO NOTHING así que la fila existe). Mantener el guard WAS-282 (account_status solo en
     perfil nuevo — `if (!existingProfile)`).

### G — admin/settlement/route.ts:264-283 (fix bug §3.5)

Antes (BUG — `p_wallet` no existe en la firma → RPC siempre falla, solo corre fallback):
```ts
const { error: rpcErr } = await supabase.rpc('increment_pending_earnings', { p_wallet: wallet, p_amount: amount })
if (rpcErr) {
  const { data: profileRow } = await supabase.from('creator_profiles')
    .select('id, pending_earnings_usdc').eq('wallet_address', wallet).single()
  if (profileRow) {
    await supabase.from('creator_profiles')
      .update({ pending_earnings_usdc: Number(profileRow.pending_earnings_usdc) + amount }).eq('id', profileRow.id)
  }
}
```
Después (resolver `id` por `wallet_address` en `creator_profiles`, luego RPC con `p_user_id`; fallback → `creator_earnings`):
```ts
const { data: profileRow } = await supabase.from('creator_profiles')
  .select('id').eq('wallet_address', wallet).single()
if (profileRow) {
  const { error: rpcErr } = await supabase.rpc('increment_pending_earnings', { p_user_id: profileRow.id, p_amount: amount })
  if (rpcErr) {
    const { data: earningsRow } = await supabase.from('creator_earnings')
      .select('pending_earnings_usdc').eq('creator_id', profileRow.id).maybeSingle()
    await supabase.from('creator_earnings')
      .update({ pending_earnings_usdc: Number(earningsRow?.pending_earnings_usdc ?? 0) + amount })
      .eq('creator_id', profileRow.id)
  }
}
```
> El fix del bug es en el CALL SITE, NO en la firma del RPC (CD-7).

### H — immediateSettlement.ts (3x zero-out, líneas 41,72,170)

Cada `await supabase.from('creator_profiles').update({ pending_earnings_usdc: 0 }).eq('id', userId)`
→ `await supabase.from('creator_earnings').update({ pending_earnings_usdc: 0 }).eq('creator_id', userId)`.
Son service_role. Hay 3 ocurrencias — cambiar las 3 (grep `pending_earnings_usdc: 0` en el archivo).

### I — Test de integración RLS (creator-earnings-rls.integration.test.ts)

Estructura (vitest, DB real vía `supabase start`; NO mockear Supabase — un mock no ejerce RLS):
```ts
import { createClient } from '@supabase/supabase-js'
// service_role client para sembrar + crear usuarios
const admin = createClient(URL, SERVICE_ROLE_KEY)

// 1. Crear 2 creators reales con password conocido
const { data: a } = await admin.auth.admin.createUser({ email: 'rls-a@test.local', password: PW, email_confirm: true })
const { data: b } = await admin.auth.admin.createUser({ email: 'rls-b@test.local', password: PW, email_confirm: true })
// el trigger AFTER INSERT crea la fila creator_earnings de cada uno; sembrar valores distintos vía admin (service_role)
await admin.from('creator_earnings').update({ pending_earnings_usdc: 99 }).eq('creator_id', b.user.id)

// 2. JWT authenticated real de A (NO SUPABASE_JWT_SECRET)
const anonClient = createClient(URL, ANON_KEY)
const { data: session } = await anonClient.auth.signInWithPassword({ email: 'rls-a@test.local', password: PW })
const aClient = createClient(URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${session.session.access_token}` } } })

// AC-1 cross-read: A intenta leer la fila de B
const { data: cross } = await aClient.from('creator_earnings').select('*').eq('creator_id', b.user.id)
expect(cross).toEqual([])                        // 0 filas, sin valores de B

// AC-1 vector legacy: A intenta leer columnas legacy de B en creator_profiles (post Fase B)
const { data: legacy, error: legacyErr } = await aClient.from('creator_profiles')
  .select('pending_earnings_usdc').eq('id', b.user.id)
expect(legacy?.[0]?.pending_earnings_usdc ?? null).toBeNull()  // 403/omitido, sin valor de B

// AC-2 self-read: A lee su propia fila → 1 fila con sus valores
const { data: self } = await aClient.from('creator_earnings').select('*').eq('creator_id', a.user.id)
expect(self).toHaveLength(1)

// AC-4 write ajena: A intenta escribir la fila de B → denegado por RLS (0 filas afectadas / error)
const { data: wr } = await aClient.from('creator_earnings').update({ pending_earnings_usdc: 0 }).eq('creator_id', b.user.id).select()
expect(wr ?? []).toEqual([])

// cleanup: admin.auth.admin.deleteUser(a...), deleteUser(b...)
```
**Vía de JWT (FIJADA)**: `auth.admin.createUser()` + `signInWithPassword`. **Fallback** si el runner
no puede llegar a la instancia: `supabase start` local con las 2 migraciones aplicadas (`supabase db reset`
las corre desde `supabase/migrations/`). Documentar en el header del test qué env necesita
(`SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).

---

## Dual-write en las migraciones (detalle)

**Fase A** (`<ts>_creator_earnings_table.sql`) — cada RPC hace `CREATE OR REPLACE` con dual-write:

```sql
-- increment_pending_earnings (Fase A: dual-write, firma + guard intactos)
CREATE OR REPLACE FUNCTION increment_pending_earnings(p_user_id UUID, p_amount NUMERIC)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'ownership mismatch';
  END IF;
  UPDATE creator_earnings  SET pending_earnings_usdc = pending_earnings_usdc + p_amount WHERE creator_id = p_user_id;
  UPDATE creator_profiles  SET pending_earnings_usdc = pending_earnings_usdc + p_amount WHERE id = p_user_id;  -- legacy mirror (Fase A)
END; $$;
```
Igual para `decrement_pending_earnings` (con `GREATEST(...-p_amount, 0)` en AMBAS) y
`record_withdrawal_and_decrement` (el `INSERT creator_withdrawals ... ON CONFLICT DO NOTHING` +
`GET DIAGNOSTICS` NO cambia; el `UPDATE` de balance se hace en AMBAS tablas).

**Fase B** (`<ts+1>_revoke_legacy_earnings_columns.sql`) — mismos 3 RPCs `CREATE OR REPLACE` a
**single-write** (borrar la línea `UPDATE creator_profiles ...`, dejar solo `creator_earnings`) +
el cierre del cross-read.

> **BLQ-ALTO-1 (post-AR):** un `REVOKE SELECT (col) ... FROM authenticated` **column-level es un
> NO-OP** — el default-ACL de Supabase otorga `SELECT` **table-level**, y el REVOKE column-level solo
> borra grants column-level. El patrón correcto (igual a `20260702020000` y al fix `anon` aplicado a
> mano hoy) es **REVOKE table-level + GRANT column-level de las columnas seguras**:

```sql
-- Cierra el SELECT table-level y re-otorga solo columnas de catálogo.
REVOKE SELECT ON public.creator_profiles FROM anon, authenticated;
GRANT SELECT (id, username, display_name, bio, avatar_url, wallet_address,
  total_models, verified, created_at, onboarding_completed, onboarding_step)
  ON public.creator_profiles TO authenticated;   -- + onboarding_* (dashboard propio)
GRANT SELECT (id, username, display_name, bio, avatar_url, wallet_address,
  total_models, verified, created_at)
  ON public.creator_profiles TO anon;             -- catálogo público, sin onboarding_*
-- writes legacy → RPC/service_role only:
REVOKE INSERT, UPDATE
  ON creator_profiles (total_earnings, pending_earnings_usdc, account_status, email_domain)
  FROM anon, authenticated;
```
Las 4 columnas financieras (`total_earnings, pending_earnings_usdc, account_status, email_domain`)
**no van en ningún GRANT** → quedan solo para `service_role`. `wallet_address` + catálogo siguen
legibles.
> Fase B se aplica **después** del cutover de código (W1 desplegado). Revocar antes rompería el
> código viejo (§4.4). NO `DROP COLUMN` (CD-12).

---

## Orden de aplicación de migraciones (el Dev NO aplica)

1. **Dev (F3)** escribe ambos `.sql` + código + tests. Verifica idempotencia leyendo los exemplars.
2. **Orquestador** aplica **Fase A** a **bdwv** (Management API) → corre parity → espera `7 / 1.477000 / 4281.250000`, diff 0 filas.
3. **Orquestador** despliega el código de W1 (cutover) **inmediatamente**.
4. **Orquestador** re-corre **solo el bloque `Reconcile` del final de Fase A** una vez, tras el deploy (cierra la ventana de drift — ver "Cutover sin-drift").
5. **Orquestador** aplica **Fase B** a **bdwv** → corre test AC-1 → verde → suite completa verde.
6. **Humano (GATE)** autoriza **caldz**: aplicar Fase A + deploy + reconcile + Fase B a caldz → parity `41 / 5.660800 / 0.000000`, diff 0.

### Cutover sin-drift (BLQ-BAJO-1 post-AR)

En la ventana **Fase-A → deploy**, los writers legacy que tocan **solo** `creator_profiles`
(el `immediateSettlement` viejo con `UPDATE creator_profiles SET pending=0` y el fallback directo
de `admin/settlement`) pueden dejar `creator_earnings` **stale**: el backfill de Fase A es
`ON CONFLICT DO NOTHING` y **no actualiza** filas ya existentes. Por eso la afirmación del SDD "sin
ventana de datos incorrectos" es correcta **solo si** se ejecuta el reconcile: el bloque
`Reconcile (re-runnable)` al final de la migración de Fase A re-alinea `creator_earnings` desde
`creator_profiles` (fuente de verdad hasta el cutover) con guard `IS DISTINCT FROM` (idempotente).
Procedimiento: **(1)** aplicar Fase A → **(2)** deploy del código nuevo INMEDIATO → **(3)** re-correr
SOLO el bloque reconcile una vez tras el deploy → **(4)** aplicar Fase B.

Parity SQL (correr antes/después del backfill en cada DB — §4.4 SDD):
```sql
-- creator_profiles (antes):  SELECT count(*), sum(pending_earnings_usdc), sum(total_earnings) FROM creator_profiles;
-- creator_earnings (después): SELECT count(*), sum(pending_earnings_usdc), sum(total_earnings) FROM creator_earnings;
-- diff (debe ser 0 filas):
SELECT p.id FROM creator_profiles p LEFT JOIN creator_earnings e ON e.creator_id = p.id
  WHERE e.creator_id IS NULL
     OR e.pending_earnings_usdc IS DISTINCT FROM p.pending_earnings_usdc
     OR e.total_earnings       IS DISTINCT FROM p.total_earnings
     OR e.account_status       IS DISTINCT FROM p.account_status
     OR e.email_domain         IS DISTINCT FROM p.email_domain;
```

---

## Constraint Directives (copiados del SDD — NO relajar)

### OBLIGATORIO
- **CD-1**: migraciones a **bdwv primero**, validar, después caldz (gate humano). Nunca mainnet-first. (El Dev solo escribe; el orquestador aplica.)
- **CD-2**: REVOKE explícito de `anon, authenticated` **por nombre** (+ `PUBLIC` si aplica). Policy service con `TO service_role` EXPLÍCITO. El default-ACL re-otorga a anon/authenticated.
- **CD-3**: migraciones idempotentes: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` antes de `CREATE TRIGGER`, `DROP POLICY IF EXISTS` antes de `CREATE POLICY`. `BEGIN;...COMMIT;`.
- **CD-4**: NO cambiar el contrato JSON de respuesta (mismos campos, mismos tipos).
- **CD-5**: AC-1 cubierto por test **automatizado contra DB real** (2 JWTs authenticated reales). "Manual" NO cuenta.
- **CD-6**: re-apuntar **TODOS** los sitios (≥13 archivos + 3 RPCs). Antes de cerrar W1, correr `grep -rn 'pending_earnings_usdc\|total_earnings\|account_status\|email_domain' src/ supabase/migrations/` y confirmar que NINGÚN reader/writer productivo apunta a las columnas legacy de `creator_profiles` (excepto el dual-write intencional de Fase A). Un writer olvidado = drift financiero silencioso.
- **CD-7**: firma EXACTA de los 3 RPCs. El fix del bug §3.5 es en el CALL SITE.
- **CD-8**: conservar el guard `IF auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN RAISE EXCEPTION 'ownership mismatch'` en `increment_pending_earnings`.
- **CD-10**: antes de tocar tests que mockean estos RPCs/queries, correr `grep 'toHaveBeenCalledWith\|toHaveBeenNthCalledWith'` en los `__tests__` afectados y ajustar args/objetos de mock (cambiar arg/query desincroniza aserciones aunque el valor sea equivalente).
- **CD-11**: Done de F3 incluye `tsc --noEmit && npm run lint && npm test` (los tres). `eslint --max-warnings 0` falla en warnings que TS no ve.

### PROHIBIDO
- **CD-9**: `wallet_address` NO se mueve. NO tocar su lectura en `status/route.ts:144-148`, el join de catálogo, ni `models.service.ts`.
- **CD-12**: NO `DROP COLUMN` sobre `creator_profiles` (reversibilidad DT-2). El drop es HU posterior.
- NO recrear `account_status_enum` (ya existe; reutilizar).
- NO agregar dependencias nuevas.
- NO crear patrones distintos a los exemplars.
- NO modificar archivos fuera de "Files to Modify/Create".
- NO aplicar NADA a la DB (bdwv/caldz) desde F3 — solo escribir los `.sql`.

---

## Test Expectations

| Test | ACs | Framework | Tipo |
|------|-----|-----------|------|
| `creator-earnings-rls.integration.test.ts` (nuevo) | AC-1, AC-2, AC-4 | vitest + **DB real** (`supabase start`) | integration |
| `settle-key-batches.test.ts` (mod) | AC-6 | vitest (mock) | unit |
| `analytics.test.ts` (mod) | AC-6 | vitest (mock) | unit |
| `withdraw-decrement.test.ts` (mod) | AC-6 | vitest (mock) | unit |
| `voucher-concurrency.test.ts` (mod) | AC-6 | vitest (mock) | unit |
| `fee-math.test.ts` (mod) | AC-6 | vitest (mock) | unit |
| Parity SQL (§4.4) | AC-5 | Management API (orquestador) | data |

### Criterio Test-First
Migración + RPCs (lógica de negocio financiera) y rutas/actions → **test-first sí**. El test de
integración RLS (AC-1) es el corazón de la HU: escribirlo apuntando al comportamiento esperado
(cross-read → `[]`) antes de dar por cerrada la Fase B.

---

## Waves

### Wave 0 (Serial Gate — Fase A, DUAL-WRITE)
- [ ] W0.1: Escribir `supabase/migrations/<ts>_creator_earnings_table.sql`: `CREATE TABLE IF NOT EXISTS
  creator_earnings` (DDL exacto §Contratos) + RLS + policies (service con `TO service_role` explícito) +
  grants + índice parcial `WHERE account_status != 'active'` + trigger `AFTER INSERT ON creator_profiles`
  (`DROP TRIGGER IF EXISTS` antes) + backfill `ON CONFLICT DO NOTHING` + 3 RPCs `CREATE OR REPLACE`
  **dual-write** (firma CD-7, guard CD-8) + re-`GRANT EXECUTE ... TO service_role` / `REVOKE ... FROM anon, authenticated`.
  Todo en `BEGIN;...COMMIT;` idempotente. Exemplars: `20260702020000`, `015`, `20260625030000`, `20260625040000`.
- [ ] Verificación W0: `tsc --noEmit` del repo pasa (aún sin cambios de código). El orquestador aplicará a bdwv + parity después de F3.

### Wave 1 (Reconciliación de código — paralelizable por grupo)
- [ ] W1.1 (self-reads authenticated): archivos #3, #4, #5, #6, #7 → pending de `creator_earnings` (Anti-Hallucination A/B/C). CD-4, CD-9.
- [ ] W1.2 (service_role reads/writes): archivos #8, #9, #10, #11, #13 (Anti-Hallucination D/E/F/G/H). Incluye el fix bug §3.5.
- [ ] W1.3 (tipos + verificación RPC call sites): archivo #16 (`models.types.ts`); **confirmar** que #12 `runSettlement.ts`, #14 `handleInvoke.ts`, #15 `withdraw/route.ts` NO requieren cambio de call (RPC re-apunta interno). Confirmar, no asumir.
- [ ] W1.4 (tests unit): actualizar mocks (archivo #18, CD-10). Si un fallo parece preexistente, verificar baseline con `git stash`.
- [ ] W1.5 (CD-6 grep exhaustivo): `grep -rn 'pending_earnings_usdc\|total_earnings\|account_status\|email_domain' src/ supabase/migrations/` → confirmar ningún reader/writer productivo apunta a legacy (excepto dual-write intencional Fase A).
- [ ] Verificación W1: `tsc --noEmit && npm run lint && npm test` (CD-11).

### Wave 2 (Test de seguridad + Fase B)
- [ ] W2.1: Escribir `creator-earnings-rls.integration.test.ts` (archivo #17, AC-1/AC-2/AC-4) contra DB real vía `supabase start` (Anti-Hallucination I). Vía JWT: `admin.createUser` + `signInWithPassword`.
- [ ] W2.2: Escribir `supabase/migrations/<ts+1>_revoke_legacy_earnings_columns.sql`: 3 RPCs `CREATE OR REPLACE` **single-write** (solo `creator_earnings`) + `REVOKE SELECT,INSERT,UPDATE ON creator_profiles (4 cols) FROM anon, authenticated`. `BEGIN;...COMMIT;` idempotente. Exemplars: `20260702010000`, `20260702020000`.
- [ ] Verificación W2: test de integración verde con Fase A+B aplicadas en la DB local; suite completa verde (AC-6).

### Wave 3 (Replicación a mainnet — GATEADA POR HUMANO — NO es trabajo del Dev)
- [ ] W3.1: **[ORQUESTADOR + GATE HUMANO]** Tras validar bdwv, aplicar Fase A + Fase B a **caldz**
  (checklist deploy CLAUDE.md). Parity caldz → `41 / 5.660800 / 0.000000`, diff 0 (CD-1). El Dev NO
  ejecuta este paso; solo dejó los `.sql` listos y validados en bdwv.

### Verificación Incremental
| Wave | Verificación |
|------|-------------|
| W0 | `tsc --noEmit` pasa; migración Fase A escrita e idempotente |
| W1 | `tsc --noEmit && npm run lint && npm test`; grep CD-6 limpio |
| W2 | test integración RLS verde (DB local con A+B); suite completa verde |
| W3 | (orquestador/humano) parity caldz |

---

## Out of Scope

- Vector `anon` (ya resuelto 2026-07-05).
- `DROP COLUMN` de las 4 columnas legacy en `creator_profiles` (HU de limpieza posterior — CD-12).
- `wallet_address` (se queda, DT-3/CD-9) — NO tocar su lectura ni el join de catálogo.
- `insert_voucher_if_none_pending` RPC (NO toca las 4 columnas — §3.1).
- Write-grants residuales de `anon` sobre `creator_profiles` (§3.4 nota — futura limpieza).
- Cambio de firma de los 3 RPCs (CD-7).
- Cambios de UI/UX del dashboard (solo cambia la fuente de datos).
- WKH-SEC-02 (repo wasiai-a2a).
- Aplicar migraciones a la DB (bdwv/caldz) — es paso de orquestador/humano, no de F3.

---

## Escalation Rule

> Si algo no está en este Story File, Dev PARA y escala a Architect. No inventar, no asumir.

Escalá si:
- El guard de `increment_pending_earnings` en la DB real difiere del snippet CD-8.
- Un call site de la tabla usa un patrón distinto al de los snippets Anti-Hallucination.
- El grep CD-6 encuentra un writer/reader de las 4 columnas NO listado en "Files to Modify/Create".
- `supabase start` no está disponible en el entorno para el test de integración (AC-1).
- La firma real de un RPC en la DB difiere de la del §Contratos.

---

*Story File generado por NexusAgil — F2.5 · WKH-SEC-03*
