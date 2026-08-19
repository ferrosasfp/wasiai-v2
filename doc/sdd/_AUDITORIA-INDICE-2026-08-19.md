# Auditoria de indice — wasiai-v2 — 2026-08-19

**Metodo**: pertenencia a `main` medida SIEMPRE con `git merge-base --is-ancestor <sha> HEAD; echo $?`,
con control negativo en la misma corrida (`origin/dependabot/npm_and_yarn/eslint-10.6.0` → exit **1**)
y control positivo. Nunca con `git log --grep` ni con la existencia de la rama.

**HEAD auditado**: `8590f9733c775be8db4b23f2873ab2f1074c56bc` (= `main` = `origin/main`).
Unico archivo sucio: `contracts/cache/solidity-files-cache.json` (artefacto de build, irrelevante).

⚠️ **CD-6**: en este repo `wasiai-prod` / `app.wasiai.io` es **produccion**; `wasiai-v2` / `wasiai-v2.vercel.app`
es **staging**. Todo lo de abajo se midio contra el repo, no contra un despliegue.

---

## Tabla

| HU | Declarado en el indice | Real (medido) | Evidencia | Commit / ancestria | Que falta |
|---|---|---|---|---|---|
| 070 — Auth Guard rutas de creador (WAS-…/HU-070) | `F2`, rama `feat/070-public-private-routes` | **IMPLEMENTADA y en `main`** | `middleware.ts:71-77`: `isProtectedRoute` cubre `/creator/dashboard` (`:72`), `/creator/agents` (`:73`), `/publish` (`:74`), `/agent-keys` (`:75`), `/pipelines` (`:76`), `/admin` (`:77`); redireccion a login en `:82` | `7017063` ("feat(HU-070): protect creator routes") ancestria **0**; `220d5ce1` ancestria **0** | Nada funcional. **Matiz medido con `git blame`**: la HU-070 escribio las lineas 72-75, pero `/pipelines` (`:76`) —que era *el* hueco declarado en su AC-1— lo agrego **WKH-AUDIT-V2** en `220d5ce1`, no la propia HU. La rama nunca se borro: eso engaño al indice. |
| 076 — config-drift address del marketplace (WKH-162) | `in progress` | **IMPLEMENTADA y en `main`** | `src/lib/contracts/marketplaceAddressCoherence.ts:2` (guard de coherencia entre las dos familias de env vars), consumido en `src/app/api/creator/earnings/voucher/route.ts:35` ("fail LOUD"), tests en `src/lib/contracts/__tests__/marketplaceAddressCoherence.test.ts:26` | `43a01c47` (2026-07-08) → ancestria **0** | Nada. |
| 077 — headers de contracting a traves del proxy (WKH-361) | `in progress (F1)`, link a `work-item.md` | **IMPLEMENTADA, F4 APROBADO y mergeada** | Codigo: `src/app/api/cron/delegation-drift/route.ts:87-107` (lee `contracting.chainHeader`/`depthHeader`, valida que sean strings); tests `src/app/api/cron/delegation-drift/__tests__/route.test.ts:2` (T-07, T-07b/AC-7, T-09, T-09b/AC-11). Pipeline completo en disco: `ar-report.md`, `ar-report-it2.md`, `cr-report.md`, `f4-report.md`. Veredicto F4 en `doc/sdd/077-wkh-361-cutover-a2a-no-cableado/f4-report.md:11` y `:406` | `c4380c81` → ancestria **0** | ⚠️ El F4 aprueba **"para merge a `main` de `wasiai-v2` — sin desplegar"** (`f4-report.md:11`). El merge ocurrio; **el despliegue no lo pude verificar desde el repo** → ver "No verificable". La fila decia `F1` teniendo `f4-report.md` al lado: era la peor clasificacion del indice. |
| 063 — Withdraw Agent Key directo | **AUSENTE** (el indice salta 062 → 064) | **IMPLEMENTADA** | `src/app/api/agent-keys/[id]/withdraw/route.ts`, mas `refund/` y `sync-balance/`; UI en `src/app/[locale]/agent-keys/page.tsx` | main | Fila agregada. |
| 066 — UI Polish | **AUSENTE** | **NO VERIFICABLE / PARCIAL** | El propio `doc/sdd/066-ui-polish/sdd.md:4` dice `Status: SPEC_APPROVED pending` — nunca paso el gate. De sus 4 areas solo pude anclar la 1a: `DepositModal` con `onSuccess` existe en `src/app/[locale]/agent-keys/page.tsx:47` | — | Decidir si se retoma o se cierra como OBSOLETA. No la marco DONE sin evidencia por area. |
| 069 (2o) — Creator Wallet Unification | **AUSENTE** (choca con la fila 069 = payment-flow-mainnet) | **IMPLEMENTADA** | `src/features/agents/components/UpgradeOnChainButton.tsx:21` cita explicitamente `// HU-069: creator_profiles.wallet_address` | main | Fila agregada como `069b`. Colision de numeracion: dos HUs distintas comparten el 069. |
| 071 — Remover thirdweb | **AUSENTE** | **IMPLEMENTADA** | `thirdweb` ya **no** figura en `package.json` (`grep -c thirdweb package.json` → **0**, con control positivo `grep -c 'next\"'` → **2**). Residuo **intencional y documentado** en `src/lib/wallet-cleanup.ts:4-5` ("thirdweb keys kept in cleanup for graceful transition") | main | Fila agregada. |

---

## Recuento

- Filas que el indice marcaba pendientes: **3** (070, 076, 077).
- Mal clasificadas: **3 de 3 (100%)** — las tres estan en `main`.
- HUs en disco **sin fila**: **4** (063, 066, 069-creator-wallet-unification, 071).
- **Pendiente de verdad: 0.** El unico residuo real es 066, que nunca paso `SPEC_APPROVED`.
- **Ninguna de las tres filas pendientes toca el camino del dinero** en el sentido de estar sin hacer; 076 (address del marketplace en el voucher EIP-712) **si** es money-path, y esta **cerrada**.

## Barrido `FALTA` (carpeta sin mencion en el indice)

- Antes: **66** · Despues: **62** · **Delta de esta auditoria: −4**, ninguna nueva.
- Las 62 restantes son mayormente ruido: filas que citan `master`/`main` en vez del slug, y una segunda serie de artefactos sueltos en la raiz de `doc/sdd/` (`040-was-137-…md`, `050-…` a `055-quality-was166-…md`) que nunca tuvo filas propias. No es deriva de estado; es que el indice y el disco usan dos convenciones distintas.

## Riesgo de documentacion detectado (no tocado)

La fila **075** enlaza `[done-report.md](075-wkh-sec-03-creator-earnings-rls/done-report.md)`, pero
`.gitignore:76` ignora `doc/sdd/075-wkh-sec-03-creator-earnings-rls/` entero.
El enlace **esta roto para cualquiera que clone el repo**. Mismo patron en `.gitignore:71-75`
(artefactos de WAS-V2-1 y los logs de activacion de produccion de la 073).

## No verificable — escalado

- **Despliegue de WKH-361 (fila 077)**: el F4 aprobo "sin desplegar". Desde el repo no hay forma de
  saber si el codigo mergeado ya esta sirviendo en staging (`wasiai-v2.vercel.app`) ni en produccion
  (`app.wasiai.io`). **Requiere confirmacion contra el deployment de Vercel.** No lo marco vivo.
- **HU-066**: 3 de sus 4 areas no tienen ancla en codigo que pueda atribuirle. Requiere decision humana.

## Instrumentos que fallaron

- `git status --porcelain` bajo el hook de `rtk` devuelve `ok ✓`. Se uso `rtk proxy`.
- `git ls-files` bajo el hook devuelve vacio siempre (falso "no trackeado"). Se uso `git check-ignore -v`.
