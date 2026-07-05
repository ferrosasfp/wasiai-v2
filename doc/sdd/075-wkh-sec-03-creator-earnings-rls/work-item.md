# Work Item — [WKH-SEC-03] Cerrar cross-read `authenticated` de earnings/PII de creators con RLS Postgres-level

## Resumen
La policy `profiles_public_read ON creator_profiles FOR SELECT USING (true)` permite que
cualquier rol `authenticated` (un creator logueado, con su propio JWT, vía REST directo
`GET /rest/v1/creator_profiles?select=*`) lea las columnas financieras/PII de **otros**
creators: `total_earnings`, `pending_earnings_usdc`, `account_status`, `email_domain`,
`wallet_address`. El vector `anon` ya se cerró (REVOKE tabla + GRANT columnas públicas,
2026-07-05). Esta HU cierra el vector `authenticated` restante moviendo las columnas
privadas a una tabla nueva `creator_earnings` con RLS por-fila (`creator_id = auth.uid()`),
dejando `creator_profiles` como catálogo público puro.

## Sizing
- SDD_MODE: full (QUALITY — superficie financiera + RLS + migración de datos en 2 proyectos Supabase)
- Estimación: L
- Branch sugerido: `fix/075-wkh-sec-03-creator-earnings-rls`

## Grounding F0 (verificado en el código, no asumido)

### Policy vulnerable — confirmada
`supabase/migrations/00000000000003_wasiai_core.sql.SKIP:80`:
```sql
CREATE POLICY "profiles_public_read" ON creator_profiles FOR SELECT USING (true);
```
**Nota crítica de grounding:** este archivo tiene extensión `.SKIP` (no se re-ejecuta como
migración), pero la policy está **confirmada viva en bdwv y caldz** por el audit 2026-07-05.
Esto significa que el historial de migraciones de `creator_profiles` está desincronizado del
estado real de la DB — el Architect (F2) **debe** verificar el estado RLS/GRANT actual
directamente contra ambos proyectos Supabase (no confiar solo en los `.sql` del repo) antes
de diseñar la migración de cierre.

También **no se encontró en el repo** la migración del fix `anon` de hoy (2026-07-05) — la
migración con fecha más reciente en `supabase/migrations/` es
`20260702020000_fix_permissive_rls_escrow_ratings.sql`. El fix anon probablemente se aplicó
directo a ambos proyectos sin commitear el `.sql` todavía. **F2 debe confirmar el estado
exacto de GRANTs de columna sobre `creator_profiles` para `anon` antes de escribir la
migración de `authenticated`**, para no pisar ese trabajo.

### 6 flujos `authenticated` que leen columnas privadas — verificados línea por línea
Todos usan `createClient()` (cliente ligado a RLS, JWT del caller) y filtran por
`.eq('id', user.id)` — el fix debe preservar exactamente este patrón de acceso "propio":

1. `src/app/[locale]/creator/dashboard/_components/EarningsSection.tsx:24-27` —
   `select('wallet_address, pending_earnings_usdc').eq('id', userId)`
2. `src/app/[locale]/creator/dashboard/page.tsx:78-82` —
   `select('onboarding_completed, onboarding_step, pending_earnings_usdc, wallet_address').eq('id', user.id)`
3. `src/app/api/creator/wallet/route.ts:28-32` (read) y `:45-48` (update) —
   `select('wallet_address, pending_earnings_usdc').eq('id', user.id)` +
   `update({ wallet_address }).eq('id', user.id)`
4. `src/app/api/creator/earnings/voucher/route.ts:35-39` —
   `select('wallet_address, pending_earnings_usdc').eq('id', user.id)`
5. **`src/actions/wallet.ts:52-71`** (corrección de ruta — el brief decía
   `src/app/[locale]/actions/wallet.ts`, la ruta real es `src/actions/wallet.ts`) —
   `linkWallet()`: `select('id, wallet_address, pending_earnings_usdc').eq('id', user.id)`
   + `update({ wallet_address }).eq('id', user.id)` cuando no hay pending bloqueante.
6. `src/app/api/creator/agents/[slug]/status/route.ts:144-148` —
   **corrección de grounding**: la lectura de `account_status` en este archivo
   (líneas 82-86) usa `serviceClient` (service_role, YA bypassea RLS — no es parte
   de la superficie authenticated). El flujo `authenticated` real en este archivo es la
   lectura de `wallet_address` en líneas 144-148: `supabase.from('creator_profiles')
   .select('wallet_address').eq('id', user.id).single()`, usada para
   `registerAgentOnChain`. Debe seguir funcionando post-fix (wallet_address queda en
   `creator_profiles`, catálogo público — no se mueve).

**Referencia — YA usan service_role (no tocar, patrón correcto):**
`src/app/api/creator/analytics/route.ts:56-60` y `src/app/api/admin/settlement/route.ts:266-283`
(este último también escribe `pending_earnings_usdc` vía `increment_pending_earnings` RPC
o UPDATE directo con `createServiceClient()`).

### Lecturas públicas que NO deben romperse — verificadas
`src/features/models/services/models.service.ts` — `getModels()`, `getModelBySlug()`,
`getFeaturedModels()` hacen join `creator:creator_profiles(id, username, display_name,
avatar_url, verified[, bio])` vía `createClient()` (anon-compatible). Solo columnas
públicas — no toca earnings/PII. Debe seguir funcionando idéntico tras el fix porque estas
columnas se quedan en `creator_profiles`.

### Escritura de `pending_earnings_usdc` — origen a reconciliar en la migración
`src/app/api/admin/settlement/route.ts:264-277`: incrementa via RPC
`increment_pending_earnings(p_wallet, p_amount)` (fallback: UPDATE directo
`creator_profiles.pending_earnings_usdc`). RPC definido en
`supabase/migrations/015_onboarding-fields.sql:16-28`. **Si la columna se mueve a
`creator_earnings`, este RPC y su fallback deben re-apuntar a la tabla nueva** — es
Scope IN de la migración, no un detalle de implementación menor.

## Acceptance Criteria (EARS)

- **AC-1** (Unwanted — cierre del vector principal): IF un usuario `authenticated`
  (creator A, con su propio JWT) hace `GET /rest/v1/creator_profiles?select=total_earnings,
  pending_earnings_usdc,account_status,email_domain,wallet_address` filtrando por el `id`
  de OTRO creator (B), THEN the system SHALL devolver 0 filas (o 403/vacío) para las
  columnas movidas a `creator_earnings`, sin exponer ningún valor de B.

- **AC-2** (Event-driven — acceso propio preservado): WHEN un creator autenticado abre su
  propio dashboard (`/creator/dashboard`) o llama `/api/creator/wallet`,
  `/api/creator/earnings/voucher`, o ejecuta `linkWallet()`, the system SHALL seguir
  devolviendo sus propios `pending_earnings_usdc`, `wallet_address`, `account_status`,
  `onboarding_step`/`onboarding_completed` sin cambios de comportamiento visible ni de
  contrato de respuesta (mismos campos, mismos valores).

- **AC-3** (State-driven — catálogo público intacto): WHILE `creator_profiles` conserva
  solo columnas de catálogo (`id, username, display_name, bio, avatar_url, verified,
  total_models, created_at`), the system SHALL mantener funcionando sin cambios el join
  público `creator:creator_profiles(...)` usado en `getModels()`, `getModelBySlug()`,
  `getFeaturedModels()`, y la lectura de `wallet_address` en
  `api/creator/agents/[slug]/status/route.ts:144-148` (queda en `creator_profiles`, no se
  mueve — es dato on-chain público).

- **AC-4** (Ubiquitous — RLS por-fila real): the system SHALL proteger la tabla
  `creator_earnings` (o el mecanismo equivalente que el Architect diseñe en F2) con una
  policy RLS `USING (creator_id = auth.uid())` para `authenticated`, de forma que ningún
  rol público pueda leer o escribir filas de un `creator_id` distinto al del JWT activo;
  `service_role` sigue bypasseando RLS para los flujos de settlement/cron/admin ya
  identificados.

- **AC-5** (Event-driven — migración sin pérdida de datos, en ambos proyectos): WHEN se
  aplica la migración de esta HU, the system SHALL migrar el 100% de las filas existentes
  de `total_earnings, pending_earnings_usdc, account_status, email_domain` desde
  `creator_profiles` hacia la tabla/estructura nueva **en bdwv (dev/testnet) Y en caldz
  (mainnet)**, verificable por conteo de filas y por suma de `pending_earnings_usdc`
  idéntica antes/después (sin drift).

- **AC-6** (Ubiquitous — regresión de tests): the system SHALL mantener en verde la
  suite de tests existente (632 tests reportados al día del audit) tras el cambio de
  esquema y de las 6 rutas/acciones reconciliadas.

## Scope IN
- `supabase/migrations/` — nueva migración (o serie) que: crea `creator_earnings` (o
  estructura equivalente decidida en F2), migra datos desde `creator_profiles`, aplica
  RLS `creator_id = auth.uid()`, y revoca el acceso directo `authenticated`/`anon` a las
  columnas financieras remanentes en `creator_profiles` (si el Architect decide dejarlas
  ahí temporalmente durante transición) o las elimina si la migración es atómica.
- Los 6 call sites listados arriba (`EarningsSection.tsx`, `dashboard/page.tsx`,
  `api/creator/wallet/route.ts`, `api/creator/earnings/voucher/route.ts`,
  `src/actions/wallet.ts`, `api/creator/agents/[slug]/status/route.ts`) — reconciliar
  sus queries al nuevo modelo (join, o segunda query a `creator_earnings`).
- RPC `increment_pending_earnings` (migración 015) y su fallback en
  `api/admin/settlement/route.ts` — apuntar a la tabla nueva si la columna se mueve.
- Aplicación de la migración en **ambos** proyectos Supabase: bdwv (dev/testnet) y caldz
  (mainnet, archivo/prod).
- Tests que ejercen estas rutas (deben actualizarse si mockean columnas de
  `creator_profiles` que se mueven).

## Scope OUT
- El vector `anon` — YA resuelto (2026-07-05), fuera de esta HU salvo verificación de que
  el fix nuevo convive con él.
- Cualquier cambio a `escrow_transactions`, `agent_ratings`, `agent_keys` u otras tablas
  tocadas por auditorías previas (20260701/20260702) — no forman parte de este hallazgo.
- Cambios de UI/UX del dashboard (solo cambia la fuente de datos, no la presentación).
- WKH-SEC-02 (RLS Postgres-level general en `a2a_agent_keys`, proyecto wasiai-a2a) — es
  un work item separado en otro repo, no se toca aquí.
- Decisión de si `creator_profiles` retiene o no las columnas legacy como
  vistas/generadas — es DT de F2, no la resuelve F1.

## Decisiones técnicas (DT-N)
- **DT-1**: El enfoque recomendado por el audit (tabla `creator_earnings` separada +
  RLS por-fila) es el punto de partida sugerido para el Architect, pero **la decisión
  final de esquema (tabla separada vs. vista + RLS directo en `creator_profiles` vs. otro
  mecanismo) es de F2**, no de este Work Item. Este AC-4 es agnóstico al mecanismo exacto
  siempre que cumpla "ningún rol público lee/escribe filas ajenas".
- **DT-2**: La migración debe ser **transaccional y reversible** (patrón ya usado en
  `20260702020000_fix_permissive_rls_escrow_ratings.sql`: `BEGIN; ... COMMIT;`) dado que
  toca datos financieros en mainnet (caldz).
- **DT-3**: `wallet_address` se queda en `creator_profiles` (es dato on-chain público, no
  PII financiera per se) — confirmado por el uso en el join de catálogo y en
  `status/route.ts:144-148`. Solo `total_earnings, pending_earnings_usdc, account_status,
  email_domain` son las columnas en disputa.

## Constraint Directives (CD-N)
- **CD-1**: OBLIGATORIO aplicar la migración en bdwv (dev/testnet) primero, validar, y
  recién después replicar en caldz (mainnet) — nunca simultáneo ni mainnet-first.
- **CD-2**: PROHIBIDO usar `REVOKE ... FROM PUBLIC` como única defensa (patrón que ya
  falló una vez en este proyecto — ver `20260702010000_fix_revoke_supabase_default_acl.sql`,
  el ACL default de Supabase re-otorga permisos explícitos a `anon`/`authenticated`
  independientemente de `PUBLIC`). La migración debe revocar explícitamente de
  `anon, authenticated` por nombre, no solo de `PUBLIC`.
- **CD-3**: OBLIGATORIO que la migración sea idempotente/re-aplicable (mismo patrón que
  las migraciones de seguridad previas de este repo).
- **CD-4**: PROHIBIDO que el fix cambie el contrato de respuesta JSON de los 6 endpoints/
  server components afectados (mismos nombres de campo, mismos tipos) — evita romper el
  frontend consumidor sin necesidad de tocarlo.
- **CD-5**: OBLIGATORIO — la verificación del cierre del vector `authenticated` (AC-1) es
  **imposible de probar manualmente en vivo** sin credenciales de dos creators reales
  logueados. QA (F4) debe cubrir este AC con un test automatizado (dos usuarios
  `authenticated` reales o simulados vía Supabase test client, uno intentando leer
  columnas del otro) con evidencia archivo:línea del test — "verificado manualmente" NO
  es evidencia válida para este AC.

## Missing Inputs
- **[bloqueante para F2]** Confirmar contra las dos instancias Supabase (bdwv y caldz)
  el estado exacto y ACTUAL de policies + grants sobre `creator_profiles` (incluyendo el
  fix `anon` de hoy, cuyo `.sql` no está en el repo) antes de diseñar la migración —
  evitar pisar o duplicar ese trabajo.
- **[resuelto en F2]** Esquema final de la tabla/mecanismo de aislamiento (DT-1) —
  decisión del Architect.
- **[resuelto en F2]** Si la migración de datos requiere downtime o puede ser online
  (dado que toca mainnet/caldz con earnings reales de creators).

## Análisis de paralelismo
- No bloquea ni es bloqueada por otras HUs activas conocidas del backlog de wasiai-v2 —
  toca únicamente `creator_profiles` + 6 call sites aislados + 1 RPC.
- **No debe correr en paralelo** con ninguna otra HU que modifique `creator_profiles`,
  `pending_earnings_usdc`, o el flujo de settlement (`admin/settlement/route.ts`,
  `increment_pending_earnings`) — riesgo de migraciones concurrentes sobre la misma tabla
  financiera.
- Relacionada pero independiente de **WKH-SEC-02** (RLS Postgres-level en
  `a2a_agent_keys`, repo wasiai-a2a) — mismo patrón de remediación (RLS por-fila,
  app-layer bypass via service_role), pero en un servicio distinto; no comparten código
  ni requieren coordinación de merge.
