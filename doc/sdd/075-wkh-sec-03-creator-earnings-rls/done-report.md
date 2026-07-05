# Report — HU [WKH-SEC-03] Cerrar cross-read `authenticated` de earnings/PII con RLS Postgres-level

## Resumen ejecutivo

WKH-SEC-03 cierra el vector de cross-read `authenticated` en `creator_profiles` moviendo las 4 columnas financieras/PII (`total_earnings`, `pending_earnings_usdc`, `account_status`, `email_domain`) a una tabla nueva `creator_earnings` con RLS por-fila (`creator_id = auth.uid()`). Pipeline QUALITY completo: **todos los 6 ACs PASS en bdwv (dev/testnet) con código mergeado a main y deployado**. caldz (mainnet) **pendiente de gate humano** para replicación post-validación.

## Pipeline ejecutado

| Fase | Entrada | Actividad | Veredicto | Artefactos |
|------|---------|-----------|-----------|-----------|
| **F0** | Audit findings | Grounding: 22 archivos leídos + 6 migraciones; estado BD verificado (bdwv/caldz); superficie ampliada detectada (~13 call sites + 3 RPCs) | ✅ LISTO | work-item.md (grounding F0+F1) |
| **F1 HU_APPROVED** | Brief | Work Item + 6 ACs EARS; Missing Inputs: estado real policies/grants (RESUELTO F2), esquema final (DT-1 decidido F2), downtime (online, F2). | ✅ APROBADO | work-item.md (220 líneas, 13.3 KB) |
| **F2 SPEC_APPROVED** | Work Item | SDD full (540 líneas): Context Map (22 archivos + §3.5 hallazgo crítico + §3.4 estado real BD), Diseño Técnico (tabla DDL + DT-1 decided + 4.4 online sin downtime + 13 call sites + 4.5 RPC re-apuntes + CD-2 REVOKE table-level), 12 CDs (5 heredados + 7 nuevos), Plan de Tests (AC-1 contra DB real, no mock), 3 Waves + dependencias. | ✅ APROBADO | sdd.md (39.9 KB) |
| **F2.5** | SDD | Story File: decisiones de orquestador fijadas (DUAL-WRITE en Fase A para cero-staleness, JWT via `admin.createUser`), 18 file list + Waves detalladas, contracts exactos. | ✅ ASIGNADO | story-WKH-SEC-03.md (32.5 KB) |
| **F3 DEV** | Story File | Implementación **completada**: 2 migraciones (`creator_earnings_table.sql` Fase A DUAL-WRITE + revoke-legacy.sql Fase B single-write), reconciliación de 13 call sites (6 self-read autenticado + 4 service_role reads + 3 RPC re-apuntes), tipo TS actualizado, tests unit ajustados (mocks), test integración AC-1 contra `supabase start` local. **Branch mergeado a main (commit 0b2359c)**. Deployed: app.wasiai.io + wasiai-v2.vercel.app. | ✅ COMPLETADO | Código en repo + auto-blindaje |
| **AR (Adversarial Review)** | F3 merged | 2 BLOQUEANTEs encontrados: BLQ-ALTO-1 (column-REVOKE SELECT NO-OP; patrón incorrecto; fix: REVOKE table-level + GRANT columnas seguras) + BLQ-BAJO-1 (ventana drift Fase A→deploy; backfill `ON CONFLICT DO NOTHING` deja stale; fix: reconcile idempotente post-deploy). Fix-pack aplicado (migraciones y procedimiento cutover re-documentado). | ✅ APROBADO (post-fix-pack) | auto-blindaje.md (3 entries) |
| **CR (Code Review)** | AR aprobado + fix-pack | 3 NITs: (1) indentación en `analytics/route.ts` (2 ocurrencias con espacios distintos → `replace_all` tomó una); (2) test mock `wallet-error-leak.test.ts` desincronizado por nueva query intermedia; (3) verificación de RPCs (`runSettlement`, `handleInvoke`, `withdraw`) — confirmar que no necesitan cambio de call. Todas resueltas. | ✅ APROBADO | code+tests |
| **F4 QA (Validación)** | CR + deploy | **6/6 ACs PASS en bdwv** (dev/testnet): AC-1 test RLS `creator-earnings-rls.integration.test.ts` (4/4 test cases green, cross-read blocked) + AC-2 (self-read dashboard/wallet preservado) + AC-3 (catálogo público intacto) + AC-4 (RLS `USING(creator_id=auth.uid())` real) + AC-5 (parity pre/post: `7 filas / 1.477000 USDC / 4281.250000 earnings` idéntico; diff 0 filas) + AC-6 (suite completa 632+ tests verde). Defectos encontrados durante validación: (a) sintaxis `REVOKE (col)` en Fase B era NO-OP (fijada en auto-blindaje); (b) test AC-1 seed asumía trigger `handle_new_user` (fijado orquestador). Ambos defectos causaron por sub-revisiones; arreglados antes de cierre. | ✅ APROBADO | test results + parity queries |

## Acceptance Criteria — resultado final

| AC | Criterio (EARS) | Status | Evidencia | Observaciones |
|----|---|--------|-----------|--------|
| **AC-1** | IF `authenticated` (creator A) intenta leer columnas de creator B → 0 filas/403 | **PASS** | `creator-earnings-rls.integration.test.ts`: test cross-read contra DB real (supabase start local); 2 usuarios `authenticated`, uno intenta SELECT pending_earnings_usdc de otro → 0 filas devueltas. Post-Fase B, SELECT sobre legacy cols en `creator_profiles` → 403 "permission denied". | Key finding AR/blindaje: column-REVOKE incorrecto; fix: table-level REVOKE + columnas permitidas. |
| **AC-2** | WHEN creator abre dashboard/wallet → THEN obtiene sus propios earnings sin cambios | **PASS** | Dashboard, `/api/creator/wallet`, `/api/creator/earnings/voucher`, `linkWallet()` — todos devuelven `pending_earnings_usdc` desde `creator_earnings` filtrando `creator_id = auth.uid()`. Contrato JSON sin cambios (CD-4). Test de humo en 5 routes; all green. | Self-read `authenticated` ahora RLS-protected contra tabla dedicada. |
| **AC-3** | WHILE `creator_profiles` es catálogo puro → THEN join público + wallet_address (no se mueve) funcionan | **PASS** | `getModels()`, `getModelBySlug()`, `getFeaturedModels()` + `status/route.ts:144-148` siguen leyendo `wallet_address` de `creator_profiles`. Join `creator:creator_profiles(id,username,display_name,bio,avatar_url,verified)` sin cambios. Marketplace listado en vivo; discovery en vivo. | Confirmado: `wallet_address` es dato on-chain público (DT-3); no se mueve. |
| **AC-4** | RLS `USING(creator_id = auth.uid())` en `creator_earnings` + service_role bypass | **PASS** | DDL: `CREATE POLICY "creator_earnings_authenticated" ON creator_earnings FOR SELECT TO authenticated USING (creator_id = auth.uid())`. Service_role tiene `GRANT ALL` + `BYPASSRLS` implícito. RPCs (dual-write Fase A) + settlement/admin routes (service_role) leen/escriben sin restricción. Test RLS: `authenticated` no puede INSERT/UPDATE fila ajena. | Policy + GRANT verificados en management API (bdwv). |
| **AC-5** | Migración 100% datos en bdwv Y caldz; conteo + suma idéntica | **PASS (bdwv)** · **PENDING (caldz)** | **bdwv**: pre-backfill `SELECT count(*), sum(pending_earnings_usdc), sum(total_earnings) FROM creator_profiles` = `7, 1.477000, 4281.250000`. Post-backfill (Fase A) = `7, 1.477000, 4281.250000` idéntico (reconcile post-deploy ejecutada). Diff query: 0 filas (todas las 4 columnas migradas sin mismatch). **caldz**: aún NO aplicada (CD-1 bdwv-first); parity esperada `41, 5.660800, 0.000000` documentada. | Dual-write Fase A + reconcile garantizan cero drift en transición. |
| **AC-6** | Suite existente verde tras cambio de esquema y 13 call sites | **PASS** | `npm test` (vitest suite) 632+ tests verde en bdwv post-deploy: unit tests mocks ajustados (CD-10); integration test AC-1 verde contra BD real; analytics/settle/withdraw/voucher tests verde. No regresiones. | Tests unit (mockeo) + integration (RLS real) ambos en verde. |

## Hallazgos finales

### Bloqueantes (resueltos en fix-pack, antes de DONE)

1. **BLQ-ALTO-1: Column-level `REVOKE SELECT` es NO-OP contra table-level GRANT**
   - **Problema**: la migración de Fase B usaba `REVOKE SELECT (col) ON creator_profiles FROM anon, authenticated` para cerrar el cross-read. No funciona: el default-ACL de Supabase otorga `SELECT` a nivel tabla; un REVOKE de columna solo revoca columnas, no tabla. El resultado: cross-read SIGUE ABIERTO.
   - **Raíz**: incomprehensión del modelo Postgres de grants (table-level > column-level). Lección: un `REVOKE` de columna NUNCA cierra acceso cuando existe table-level grant.
   - **Fix**: REVOKE table-level (`REVOKE SELECT ON creator_profiles FROM anon, authenticated`) + GRANT column-level **solo** columnas permitidas. Patrón confirmado en `20260702010000` (fix `anon`) y en `20260702020000` (fix RLS escrow).
   - **Documentado en auto-blindaje** como lección de aplicar para próximas HUs.

2. **BLQ-BAJO-1: Ventana de drift Fase A→deploy**
   - **Problema**: entre el backfill de Fase A (`ON CONFLICT DO NOTHING`) y el deploy del código nuevo, writers legacy (ej: `immediateSettlement` viejo) tocan solo `creator_profiles`. El backfill `ON CONFLICT` no re-actualiza filas existentes; resulta: `creator_earnings` queda stale.
   - **Raíz**: procedimiento de cutover no explícitamente ordenado. `ON CONFLICT DO NOTHING` es correcto para no pisar, pero requiere un reconcile post-deploy.
   - **Fix**: migración de Fase A incluye un bloque `RECONCILE` idempotente (UPDATE ... WHERE IS DISTINCT FROM) re-ejecutable post-deploy, antes de Fase B. Procedimiento documentado en Story File.
   - **Aceptado como lección no-bloqueante** siempre que reconcile se ejecute post-deploy.

### Menores (aceptados durante VALIDATION, sin bloqueo de DONE)

1. **Indentación `analytics/route.ts`**: `replace_all` falló por espacios distintos en 2 ocurrencias. Corregido post-hoc. **Lección**: verificar con grep DESPUÉS de `replace_all` cuando un literal aparece en múltiples contextos de indentación.

2. **Test mock `wallet-error-leak.test.ts`**: desincronizado por inserción de query intermedia. Corregido agregando `earningsChain` al mock. **Lección**: correr suite COMPLETA tras cambios en rutas, no solo los tests listados en el Story File.

3. **Verificación RPC call sites**: `runSettlement.ts`, `handleInvoke.ts`, `withdraw/route.ts` NO necesitaban cambios de call (RPC se re-apunta en migración, firma intacta). Confirmado y documentado.

## Auto-Blindaje consolidado

| Fecha | Tipo | Descripción | Aplicar en próximas HUs |
|-------|------|-------------|------------------------|
| 2026-07-05 02:38 | Anti-Patrón | `replace_all` no cubrió ocurrencia con indentación distinta. Verificar con `tsc`/grep DESPUÉS de `replace_all`. | Siempre que un literal esté en múltiples ramas (early-return, return principal, etc.). |
| 2026-07-05 02:41 | Anti-Patrón | Mock `mockReturnValueOnce` encadenado se desincroniza al agregar query intermedia. Correr suite COMPLETA, no solo tests nombrados. | Tras cambios en rutas/mocks. Agregar mock en la posición del nuevo `from()`. |
| 2026-07-05 09:00 | Footgun Supabase | Column-level `REVOKE SELECT` es NO-OP; necesita REVOKE table-level + GRANT columnas. Confirmar que NO existe table-level grant antes de asumir seguridad de column-level. | **CRÍTICO** para próximas HUs de cierre de cross-read/PII. Patrón correcto: `REVOKE ... ON tabla ... FROM rol` (tabla) → `GRANT (cols seguras)` (columna). |
| 2026-07-05 09:00 | Procedimiento Cutover | Migración additiva + dual-write + backfill `ON CONFLICT DO NOTHING` requiere reconcile post-deploy idempotente. Documentar orden explícito: Fase A → deploy inmediato → reconcile → Fase B. | Migración online con writers legacy. Sin reconcile, drift silencioso. |

## Archivos modificados

### Migraciones SQL (2 archivos)

| Archivo | Qué | Líneas | Estado |
|---------|-----|--------|--------|
| `supabase/migrations/20260705000000_creator_earnings_table.sql` | Fase A: CREATE `creator_earnings` + RLS + policies + grants + trigger + backfill + 3 RPCs **DUAL-WRITE** (firma intacta, ownership guard conservado) + reconcile | ~180 | ✅ Mergeado |
| `supabase/migrations/20260705000001_revoke_legacy_earnings_columns.sql` | Fase B: 3 RPCs **single-write** + `REVOKE SELECT,INSERT,UPDATE` table-level de 4 columnas legacy de `anon, authenticated` + `GRANT SELECT` de columnas seguras a `authenticated` (onboarding_*) | ~80 | ✅ Mergeado |

### Código aplicación (13 archivos)

| Ruta | Cambio | Detalle |
|------|--------|---------|
| `src/app/[locale]/creator/dashboard/_components/EarningsSection.tsx` | Modificado | Lectura `pending_earnings_usdc` desde `creator_earnings`; `wallet_address` sigue en `creator_profiles`. Ambas en el mismo `select()` via 2ª query o embed FK. |
| `src/app/[locale]/creator/dashboard/page.tsx` | Modificado | Idem: `onboarding_*` + `wallet_address` de profiles; pending de earnings. |
| `src/app/api/creator/wallet/route.ts` | Modificado | Split de queries: `creator_profiles` (wallet, onboarding) + `creator_earnings` (pending). Bloqueo por pending sin cambio de lógica. Respuesta `{ok}` sin cambio (CD-4). |
| `src/app/api/creator/earnings/voucher/route.ts` | Modificado | Lectura pending de `creator_earnings`; voucher payload idéntico. |
| `src/actions/wallet.ts` | Modificado | Lectura pending + bloqueo de cambio wallet. Return `{success}` sin cambio (CD-4). |
| `src/app/api/creator/analytics/route.ts` | Modificado | service_role: pending de `creator_earnings`; account_status aún aquí. Respuesta sin cambio (CD-4). |
| `src/app/api/creator/agents/[slug]/status/route.ts` | Modificado | service_role: `account_status` → `creator_earnings`; `wallet_address` (authenticated) sin cambio (CD-9). |
| `src/app/api/v1/agents/register/route.ts` | Modificado | INSERT catalog en `creator_profiles` (trigger crea fila earnings) → UPDATE `creator_earnings` email_domain/account_status. Lookup anti-abuso sobre `creator_earnings`. |
| `src/app/api/admin/settlement/route.ts` | Modificado | Fix bug RPC §3.5 (`p_wallet` → `p_user_id`) + fallback UPDATE → `creator_earnings`. |
| `src/lib/settlement/immediateSettlement.ts` | Modificado | 3x `UPDATE creator_profiles SET pending_earnings_usdc = 0` → `creator_earnings`. |
| `src/features/models/types/models.types.ts` | Modificado | Sacar `total_earnings` de `CreatorProfile` (tipo); no hay new type (creación simple en las queries sin typed return). |
| `src/lib/settlement/runSettlement.ts` | Verificado | RPC call SIN CAMBIO (se re-apunta en migración, firma intacta CD-7). |
| `src/lib/invoke/handleInvoke.ts` | Verificado | RPC call SIN CAMBIO. |
| `src/app/api/creator/withdraw/route.ts` | Verificado | RPC call SIN CAMBIO. |

### Tests (6 archivos)

| Ruta | Cambio | Detalle |
|------|--------|---------|
| `src/app/api/creator/__tests__/creator-earnings-rls.integration.test.ts` | Creado | Test AC-1/AC-2/AC-4 contra DB real (supabase start local). 4 test cases: cross-read bloqueado, self-read permitido, write ajena bloqueada, write propia permitida (service_role). |
| `src/app/api/creator/__tests__/settle-key-batches.test.ts` | Modificado | Mock RPC dual-write args ajustados (CD-10). |
| `src/app/api/creator/__tests__/analytics.test.ts` | Modificado | Mock queries split ajustados (pending de earnings). |
| `src/app/api/creator/__tests__/withdraw-decrement.test.ts` | Modificado | Mock RPC args ajustados. |
| `src/app/api/creator/__tests__/voucher-concurrency.test.ts` | Modificado | Mock queries ajustadas. |
| `src/app/api/creator/__tests__/wallet-error-leak.test.ts` | Modificado | **Descubierto durante F3**: mock desincronizado por query intermedia. Agregado `earningsChain` al mock secuencial. |

## Estado de deploy

| Entorno | Fase A | Fase B | Parity | Status |
|---------|--------|--------|--------|--------|
| **bdwv** (dev/testnet) | ✅ Aplicada | ✅ Aplicada | ✅ `7 / 1.477000 / 4281.250000` (diff 0) | **LISTO** · Marketplace en vivo · Test RLS 4/4 · Suite 632+ verde |
| **caldz** (mainnet/prod) | ⏳ Pendiente | ⏳ Pendiente | — (esperado `41 / 5.660800 / 0.000000`) | **GATEADO POR HUMANO** (W3 checklist infra) |

Código en repo: **mergeado a main (0b2359c)**, deployado en app.wasiai.io + wasiai-v2.vercel.app (post-F4 validación).

## Checklist de replicación a caldz (mainnet, gateado)

**Pre-requisito**: Humano autoriza post-validación de bdwv.

```bash
# 1. Preparación
$ git checkout main
$ git pull origin main

# 2. Obtener credenciales caldz
SUPABASE_PROJECT_ID=caldzjhjgctpgodldqav  # wasiai-prod
SUPABASE_ACCESS_TOKEN=<token-from-dashboard>

# 3. Fase A (table + RLS + dual-write RPCs + backfill + reconcile)
$ supabase migration up \
    --project-id $SUPABASE_PROJECT_ID \
    -- < supabase/migrations/20260705000000_creator_earnings_table.sql

# 4. Validación parity (Fase A) — debe retornar 41 / 5.660800 / 0.000000
$ supabase query \
    --project-id $SUPABASE_PROJECT_ID \
    "SELECT count(*), sum(pending_earnings_usdc), sum(total_earnings) FROM creator_earnings;"

# 5. Verificación de drift — debe retornar 0 filas (perfecta parity)
$ supabase query \
    --project-id $SUPABASE_PROJECT_ID \
    "SELECT p.id FROM creator_profiles p LEFT JOIN creator_earnings e ON e.creator_id = p.id \
     WHERE e.creator_id IS NULL \
        OR e.pending_earnings_usdc IS DISTINCT FROM p.pending_earnings_usdc \
        OR e.total_earnings       IS DISTINCT FROM p.total_earnings \
        OR e.account_status       IS DISTINCT FROM p.account_status \
        OR e.email_domain         IS DISTINCT FROM p.email_domain;"

# 6. Reconcile post-deploy (si fue necesario en bdwv, replicate el bloque)
# [Se ejecuta si hay divergencias detectadas post-deploy del código]

# 7. Fase B (REVOKE table-level + single-write RPCs + grants columnas seguras)
$ supabase migration up \
    --project-id $SUPABASE_PROJECT_ID \
    -- < supabase/migrations/20260705000001_revoke_legacy_earnings_columns.sql

# 8. Verificación post-Fase B
$ supabase query \
    --project-id $SUPABASE_PROJECT_ID \
    "SELECT count(*), sum(pending_earnings_usdc), sum(total_earnings) FROM creator_earnings;"
# [Debe ser idéntico a post-Fase A]

# 9. Smoke test RLS (si se ejecuta contra caldz con 2 creators de test)
# [Correr subset del test AC-1 contra caldz, o confiar en bdwv validation]

# 10. Confirmación
echo "✅ caldz (mainnet) replicación COMPLETADA"
```

**Notas críticas**:
- **No simultanear**: Fase A y B son secuenciales. Esperar validación post-A antes de B.
- **Parity esperada caldz**: `41 filas / 5.660800 USDC pending / 0.000000 earnings` (sin cambios, mirror exacto).
- **Drift 0**: la query de verificación DEBE retornar 0 filas.
- **Rollback si es necesario**: revertir ambas migraciones en orden inverso (Fase B → Fase A).

## Lecciones para próximas HUs

1. **Footgun Supabase: Column-level REVOKE contra table-level GRANT** (CRÍTICO)
   - El default-ACL de Supabase otorga SELECT table-level a `anon`/`authenticated`. Un REVOKE de columna NO cierra acceso si el grant table-level existe.
   - **Patrón correcto**: REVOKE table-level → GRANT solo columnas permitidas (por rol).
   - **Verificación**: antes de asumir "protegida por column-level REVOKE", confirm con `SELECT column_privileges FROM information_schema.role_table_grants`.
   - **Aplicable a**: próximas HUs de cierre de cross-read/PII sobre tablas con RLS `USING(true)` o catálogo público.

2. **Replace_all con indentación variable**
   - Un literal que aparece en múltiples ramas (early-return, return final) puede tener indentación distinta. `replace_all: true` matchea texto exacto (incluyendo espacios).
   - **Verificación post-replace**: `tsc --noEmit` + `grep` exhaustivo para confirmar que no quedaron referencias old.
   - **Alternativa**: buscar la ocurrencia con contexto más amplio para capturarlo en una edición (aceptable si son pocas).

3. **Mocks encadenados `mockReturnValueOnce` sin buffer**
   - Cuando una ruta hace múltiples `from()` sequenciales (query 1, query 2, ...), cada `mockReturnValueOnce` devuelve uno. Agregar una query intermedia = desincronización del orden.
   - **Verificación**: correr suite COMPLETA tras cambios en rutas, no solo tests nombrados. Vitest es sensible al orden.
   - **Fix**: insertar mock en la posición exacta del nuevo `from()`.

4. **Cutover online: dual-write + backfill + reconcile**
   - Fase A (tabla + dual-write) + Fase B (single-write) + writers legacy crean una ventana de drift si no se reconcilia.
   - **Orden**: Fase A → deploy inmediato → reconcile (si es necesario) → Fase B.
   - **Reconcile debe ser idempotente** (UPDATE ... WHERE IS DISTINCT FROM), reutilizable.
   - **No asumir "sin ventana"**: documentar explícitamente en Story File.

---

## Resumen de status para cierre

- ✅ **F0/F1**: HU_APPROVED (trabajo item + 6 ACs EARS)
- ✅ **F2**: SPEC_APPROVED (SDD full 540 líneas, 12 CDs, Context Map grounding 22 archivos)
- ✅ **F2.5**: Story File asignado (18 file list, waves, contracts exactos)
- ✅ **F3**: Implementación COMPLETADA (2 migraciones + 13 call sites + tests)
- ✅ **AR**: APROBADO post-fix-pack (2 BLQ → 0 BLQ remanentes)
- ✅ **CR**: APROBADO (3 NITs resueltos)
- ✅ **F4**: APROBADO (6/6 ACs PASS en bdwv, test RLS 4/4 green)

**Deliverables finales entregados**:
1. ✅ `done-report.md` (este archivo)
2. ✅ `_INDEX.md` actualizado (status DONE, link report)
3. ✅ Auto-Blindaje consolidado (4 lecciones)
4. ✅ Checklist caldz documentado (para orquestador)

**Próximo paso**: Orquestador ejecuta gate humano (W3 CD-1: bdwv validado → autoriza caldz). No hay bloques remanentes.

---

*Report generado por NexusAgil — DONE · WKH-SEC-03 · 2026-07-05*
