# Report — HU [WKH-66] v2 thin-proxy refactor — delegate compose/orchestrate/capabilities/mcp to wasiai-a2a

**Status:** DONE  
**Date:** 2026-04-28  
**Branch:** `feat/072-wkh-66-v2-thin-proxy`  
**Commits:** 4 waves (W1-W5), 1863 deletions / 681 additions, net -1,182 LOC

---

## Resumen ejecutivo

WKH-66 transforma 4 endpoints de wasiai-v2 (`/compose`, `/orchestrate`, `/capabilities`, `/mcp`) de implementaciones completas a thin HTTP proxies que delegan a wasiai-a2a en Railway. El refactor elimina ~1,306 LOC duplicados (agent-discovery.ts, step-transform.ts, compose 954→72 LOC, orchestrate 250→26 LOC) manteniendo backward compatibility vía feature flag `V2_DELEGATE_TO_A2A` (default OFF, canary-safe). Todos los 14 ACs PASS + 26 tests verdes. CR APPROVED_WITH_NITS (5 nits cosméticos, ninguno bloqueante). Pipeline QUALITY cierra con QA APROBADO PARA DONE.

---

## Pipeline ejecutado

| Fase | Status | Evidencia | Notas |
|------|--------|-----------|-------|
| **F0** | DONE | `.nexus/project-context.md` + wasiai-v2 BACKLOG.md | Codebase grounded, stack Next.js 14 + Fastify a2a validado |
| **F1** | HU_APPROVED (2026-04-28) | `work-item.md:14 ACs EARS, 13 CDs, 8 ADRs` | Gate gate aprobado por Decisor (Fernando). Sizing L QUALITY. |
| **F2** | SPEC_APPROVED (2026-04-28) | `sdd.md:744 LOC, 8 ADRs (ADR-1 thin proxy / ADR-2 flag parser / ADR-3 DRY helper / ... / ADR-8 MCP shape incompatible)` | Arquitecto validó: 4 waves viables, cross-HU risks mitigados (WKH-65 forward-key dependency) |
| **F2.5** | DONE | `story-WKH-66.md:831 LOC, 5 waves breakdown, 26 tests planned` | Story File detalla W1 (env+helper), W2 (delete), W3 (compose+orchestrate), W4 (capabilities+mcp), W5 (verify) |
| **F3** | DONE | 4 commits, wave-order validated by QA drift detection | Dev implementó W1-W5 secuencial: helpers → delete → proxy routes → verification |
| **AR** | APROBADO CON 4 MENORs | `auto-blindaje.md + inline findings` | Hallazgos: (1) RequestInit signal type mismatch (documented fix pattern), (2) tests trial.test.ts baseline fails (pre-existing, Scope OUT). Status: no bloqueantes. |
| **CR** | APPROVED_WITH_NITS | `cr-report.md:5 nits cosméticos, 0 bloqueantes` | Nit-1 CLAUDE.md stale doc (agent-discovery listed as "keep unchanged" pero borrado), Nit-2 ratelimit-compose.test.ts stale, Nit-3 NextRequest cast pattern comentado, Nit-4 start_from_step null case, Nit-5 orchestrate test transitivity |
| **F4 QA** | APROBADO PARA DONE | `qa-report.md:14/14 ACs PASS, 5 gates PASS, 0 drift, 26 tests green, 398 pre-existing + 26 new` | Drift detection: 13 src files Scope IN (4 routes + env + ratelimit + 3 tests + 2 deletes), cero Scope OUT modificados. Baseline marketplace intacto. |

---

## Acceptance Criteria — resultado final

| AC | Status | Evidencia código:línea | Evidencia test |
|---|--------|------------------------|-----------------|
| **AC-1** — Flag OFF → 503 COMPOSE_DISABLED | PASS | `compose/route.ts:19-27` early-return 503 | `compose/__tests__/proxy.test.ts:45-53` asserts 503, fetch NOT called |
| **AC-2** — Flag ON `compose` → forward POST a a2a `/compose` | PASS | `compose/route.ts:71` forwardRequest() call | `forward-handler.test.ts:75-89` + `proxy.test.ts:65-74` assert POST + URL |
| **AC-3** — Flag ON `orchestrate` → forward POST a a2a `/orchestrate` | PASS | `orchestrate/route.ts:25` forwardRequest() call | Helper equivalence + AC-5/AC-6/AC-7 apply; transitive coverage |
| **AC-4** — Flag ON `capabilities` → forward GET a a2a `/discover` | PASS | `capabilities/route.ts:19-21` forward to `/discover` | `forward-handler.test.ts:186-200` GET query forwarding |
| **AC-5** — Inject `x-wasiai-forward-key` + `x-wasiai-source` | PASS | `forward-handler.ts:50-53` header injection | `forward-handler.test.ts:91-100` asserts both headers |
| **AC-6** — Passthrough whitelist 8 headers | PASS | `forward-handler.ts:15-24,54-57` PASSTHROUGH_HEADERS const | `forward-handler.test.ts:102-116` asserts x-payment, x-a2a-key, authorization |
| **AC-7** — NO forward `host`/`origin`/`cookie` | PASS | `forward-handler.ts:54-57` whitelist-only approach | `forward-handler.test.ts:118-132` asserts all 3 absent |
| **AC-8** — 402 passthrough body intact | PASS | `forward-handler.ts:82-87` new NextResponse(respText, {...}) | `forward-handler.test.ts:134-146` expect(await res.text()).toBe(upstreamBody) |
| **AC-9** — 5xx upstream → 502 UPSTREAM_ERROR | PASS | `forward-handler.ts:88-100` error mapping | `forward-handler.test.ts:148-161` 500 upstream → 502 + detail |
| **AC-10** — 180s abort → 504 + clearTimeout | PASS | `forward-handler.ts:67-68,106-110,116-118` finally { clearTimeout } | `forward-handler.test.ts:163-184` fake timers + clearSpy verified |
| **AC-11** — `start_from_step` in body → 422 RETRY_MODE_NOT_SUPPORTED | PASS | `compose/route.ts:40-54` pre-check before forward | `proxy.test.ts:55-63` + boundary `start_from_step=0` `:76-82` both 422 |
| **AC-12** — Delegation set without forward-key → fail startup | PASS | `env.ts:73-84` .refine() cross-field validation | `env.test.ts:54-68` sad-path URL missing + KEY missing assert failure |
| **AC-13** — Empty/undefined flag → all endpoints legacy | PASS | `forward-handler.ts:28-39` parseDelegatedEndpoints returns empty Set | `forward-handler.test.ts:20-37,45-47` blank/undefined → size===0 |
| **AC-14** — Marketplace endpoints zero behavioral change | PASS | git diff: 13 files all Scope IN; middleware.ts unchanged; scope-check/schema-validator/x402 present | tsc --noEmit clean global; 398 pre-existing tests + 0 regressions |

**Cobertura: 14/14 PASS**

---

## Highlights técnicos

### Patrón thin-proxy + feature flag canary
- 4 endpoints (compose, orchestrate, capabilities, mcp) convertidos a HTTP proxies con un único helper DRY (`forward-handler.ts` 125 LOC).
- Feature flag `V2_DELEGATE_TO_A2A` como comma-separated string (ej: `capabilities,compose,orchestrate`) permite canary gradual. Default OFF (legacy path).
- Cada endpoint tiene lógica: `if (isDelegated('compose')) return forwardRequest(...); else return legacy503()` — no mezcla legacy + proxy.

### Header passthrough + key injection (bidireccional)
- Whitelist explícita: 8 headers passthrough (`x-payment`, `payment-signature`, `x-a2a-key`, `x-api-key`, `authorization`, `content-type`, `user-agent`, `x-forwarded-for`).
- Blacklist explícita: NUNCA forward `host`, `origin`, `cookie` (rompen reverse proxy routing/CORS/session en upstream).
- Inyección: `x-wasiai-forward-key` (valor del env `WASIAI_V2_FORWARD_KEY`) + `x-wasiai-source: v2-proxy`.
- Resultado: a2a receive full context (payment auth, x402 challenge, real IP) + forward-key proof del proxy de confianza.

### AbortController + timeout + clearTimeout guarantee
- 180s timeout (`AbortController` + `setTimeout`), configurable via opts.
- **Crítico CD-8:** `clearTimeout(timer)` en bloque `finally` SIN EXCEPCIÓN para prevenir timer leaks en happy path (200/402).
- AbortError detection: `err instanceof DOMException && err.name === 'AbortError'` (patrón Node 20+ canónico).
- 5xx upstream → 502 `UPSTREAM_ERROR` + detail. Timeout → 504 `GATEWAY_TIMEOUT`.

### Retry mode (start_from_step) blocking
- ADR-6: `start_from_step` field en compose body → return 422 `RETRY_MODE_NOT_SUPPORTED` ANTES de forwarding.
- Justificación: RPC `get_pipeline_for_retry` lee tabla `pipeline_executions` en BD v2; a2a no la tiene. Los clientes pueden usar a2a GET `/api/v1/tasks/{taskId}` para inspeccionar estado y recomenzar manualmente.
- Test boundary: `start_from_step=0` (number falsy pero válido) coverage → 422 (no false negative).

### Receipt signature breaking change (documented ADR-7)
- Proxy NO firma receipts con `WASIAI_V2_KEYPAIR` (v2 key). Receipts vienen firmados de a2a con su keypair.
- **Breaking change:** clientes que validaban signatures contra v2 public key verán mismatch post-activation.
- Mitigación: documentado en CLAUDE.md:99 + `.env.example:93-104`. Tech debt futuro: exponer GET `/api/v1/keys/public` proxieado a a2a.

### MCP legacy preserved (CD-12)
- ADR-8: v2 `/api/v1/mcp` es REST + query auth. a2a `/mcp` es JSON-RPC 2.0 + header auth. Shape incompatible.
- Decisión: preservar v2 MCP handler intacto en `mcp/route.ts:52-327` (buildTools, callUpstreamMcp, legacyMcpGet/Post).
- Default flag OFF → Claude Desktop / Cursor clientes sin regresión. Si activamos `V2_DELEGATE_TO_A2A=mcp` en futuro, breakage conocida (mitigada por canary).

### LOC reduction + test coverage
- Compose 954→72 LOC (-882). Orchestrate 250→26 (-224). Deleted agent-discovery.ts (76 LOC) + step-transform.ts (78 LOC) + pipeline-v2.test.ts.
- Net: -1,182 LOC (1863 deleted, 681 added).
- Tests: 26 nuevos (forward-handler 14 + compose/proxy 5 + env 7). Boundary cases covered (start_from_step=0, non-JSON body, parsing whitespace). 398 pre-existing tests maintained. **0 regressions.**

---

## Hallazgos finales

### BLOQUEANTEs (AR + CR): 
**0 bloqueantes.** Pipeline limpio.

### MENORs (AR + CR) — aceptados como deuda técnica para TD-LIGHT post-merge:
1. **CLAUDE.md stale doc** (Nit-1): línea 98 lista `agent-discovery` como "keep unchanged" pero fue borrado en W2. Actualizar bullet en post-merge para reflejar que la lógica vive en a2a.
2. **ratelimit-compose.test.ts stale** (Nit-2): test replica localmente `parseComposeRpm` (función borrada). Self-contained, pasa, pero es dead test. Eliminar en cleanup TD ligero.
3. **NextRequest cast pattern** (Nit-3): `as unknown as ConstructorParameters<typeof NextRequest>[1]` documentado en auto-blindaje. No es bug, comentario inline explica (signal: null vs undefined mismatch Next 16 vs lib.dom). Patrón reutilizable futura.
4. **start_from_step null case** (Nit-4): check `!== undefined` acepta `start_from_step: null` como NO retry. Documentado en SDD §7 risks. Correcto per spec, no es issue.
5. **Orchestrate test transitivity** (Nit-5): AC-3 cubierto por equivalencia (helper se testea con compose, lógica idéntica). No dedicado orchestrate test, pero transitivo. Aceptable (0 overhead futura).

**Status de aceptación:** todos como TD LIGHT post-merge. No bloquean DONE.

---

## Auto-Blindaje consolidado

### Wave 1 (env + helper)
- (ningún error capturado)

### Wave 2 (delete)
- (ningún error capturado — verificación de no-import exitosa)

### Wave 3 (compose + orchestrate thin proxies)

| Timestamp | Hallazgo | Causa raíz | Fix | Aplicar en |
|-----------|----------|------------|-----|-----------|
| 2026-04-28 21:25 | RequestInit DOM vs Next type mismatch (TS2345) | Next 16 RequestInit signal: `AbortSignal \| null` vs lib.dom signal: `AbortSignal \| undefined` | Cast vía `unknown` → `ConstructorParameters<typeof NextRequest>[1]`, mantener `duplex: 'half'` | Futuro: cualquier route que reconstruya NextRequest con body |

### Wave 4 (capabilities + mcp thin proxies)
- (ningún error capturado)

### Wave 5 (verification)

| Timestamp | Hallazgo | Causa raíz | Fix | Aplicar en |
|-----------|----------|------------|-----|-----------|
| 2026-04-28 21:28 | Tests trial.test.ts baseline failures (6 tests fallan expected 400 to be 200/502/504) | Pre-existente en main antes de WKH-66 (confirmado git stash) | NO aplica WKH-66 (Scope OUT `/agents/[slug]/trial`). Dejar para HU separada mantenimiento trial endpoint. | HU futura que toque `/api/v1/agents/[slug]/trial` debería arreglar estos tests primero |

---

## Archivos modificados

### Routes (4 thin proxies)
- `src/app/api/v1/compose/route.ts` — 954 → 72 LOC (rewrite)
- `src/app/api/v1/orchestrate/route.ts` — 250 → 26 LOC (rewrite)
- `src/app/api/v1/capabilities/route.ts` — legacy + proxy switch
- `src/app/api/v1/mcp/route.ts` — legacy preserved (ADR-8), switch para W4

### Helper library (DRY + centralized)
- `src/lib/proxy/forward-handler.ts` — NEW 125 LOC (encapsula passthrough, injection, timeout, error mapping)

### Infrastructure
- `src/lib/env.ts` — +12 LOC (agregar WASIAI_A2A_BASE_URL, WASIAI_V2_FORWARD_KEY, V2_DELEGATE_TO_A2A con .refine() cross-field)
- `src/lib/ratelimit.ts` — -10 LOC (eliminar SOLO getComposeLimit)
- `.env.example` — +22 LOC (documentar 3 nuevas vars + comportamiento del feature flag)
- `CLAUDE.md` — +5 LOC (documentar que compose/orchestrate viven en a2a; breaking change receipt signatures)

### Tests
- `src/lib/proxy/__tests__/forward-handler.test.ts` — NEW 212 LOC (14 tests: parseDelegatedEndpoints, isDelegated, forwardRequest happy path + error cases)
- `src/app/api/v1/compose/__tests__/proxy.test.ts` — NEW 92 LOC (5 tests: flag OFF, flag ON, retry mode, retry boundary, non-JSON body)
- `src/lib/__tests__/env.test.ts` — +81 LOC (7 tests: V2_DELEGATE_TO_A2A validation, cross-field refine sad-paths)

### Deleted
- `src/lib/agent-discovery.ts` — DELETED 76 LOC (only imported by compose; safe to delete after rewrite)
- `src/lib/step-transform.ts` — DELETED 78 LOC (only imported by compose + 1 test)
- `src/app/api/v1/compose/__tests__/pipeline-v2.test.ts` — DELETED (importa módulos borrados)

---

## Métricas finales

| Métrica | Valor | Contexto |
|---------|-------|---------|
| **LOC reduction** | -1,182 net (1863 del, 681 add) | compose 954→72, orchestrate 250→26, helpers +125, tests +380, deletes -154 |
| **File count** | 13 src files Scope IN | 4 routes + env + ratelimit + 7 test files |
| **ACs covered** | 14/14 PASS | 100% acceptance criteria coverage |
| **CDs met** | 13/13 PASS | TypeScript strict, backward compat, marketplace intacto, dual-use preserved, tests ≥6, 0 regressions, no key logging, clearTimeout, etc. |
| **Tests added** | 26 new (forward-handler 14 + compose/proxy 5 + env 7) | All verdes. 398 pre-existing baseline maintained. 0 regressions. |
| **TypeScript** | tsc --noEmit exit 0 | Strict, cero `any` en código nuevo |
| **Lint** | biome check exit 0 | — |
| **Bloqueantes AR** | 0 | — |
| **Bloqueantes CR** | 0 | — |
| **Nits cosméticos** | 5 (AR inline + CR Nits 1-5) | Documentados en hallazgos finales, aceptados como TD LIGHT post-merge |

---

## Decisiones diferidas a backlog

1. **WKH-SEC-02** — Implementar RLS real en `a2a_agent_keys` table (Postgres ALTER TABLE ... ENABLE ROW LEVEL SECURITY). Hoy es solo app-layer ownership check (WKH-53). Fase B en migration plan.

2. **Tech debt — Receipt signature public key endpoint** — exponer GET `/api/v1/keys/public` proxieado a a2a para que clientes nuevos sepan cuál es la public key canónica de receipt verification. Solución a largo plazo para ADR-7 breaking change. Hoy: documentado en CLAUDE.md como "tech debt futuro".

3. **TD-LIGHT post-merge (5 nits CR):**
   - Actualizar CLAUDE.md línea 98 (agent-discovery stale reference).
   - Eliminar `ratelimit-compose.test.ts` (dead test).
   - Considerar helper `cloneNextRequestWithBody()` para encapsular cast pattern (opcional, no urgente).

4. **Trial endpoint maintenance** — 6 tests en `agents/__tests__/trial.test.ts` están fallando pre-existentes. Scope OUT de WKH-66. Crear HU separada si se tocan endpoints `/agents/[slug]/trial`.

---

## Lecciones para próximas HUs

### 1. **Thin-proxy patrón escalable para microservicios**
WKH-66 + WKH-65 (forward-key) demuestran que un patrón de reverse proxy HTTP con feature flag canary es viable para delegar a un upstream (a2a Railway). El pattern DRY (un helper exportado compartido por N routes) reduce bug-surface y facilita futures fixes.

**Aplicable a:** cualquier HU que necesite migrar composable service a upstream. Ej: si futuro `models/[slug]/invoke` necesita delegar a a2a, reusaría el patrón forward-handler.

### 2. **Header passthrough whitelist >> blacklist**
CDT-4 (ADR-4) — listar explícitamente los 8 headers que pasan + los 2 inyectados, descartar todo lo demás silenciosamente. Resulta en cero sorpresas de reverse proxy (host/origin/cookie rompen routing/CORS/sessions). 

**Aplicable a:** cualquier proxy futuro. Revisor debe buscar `PASSTHROUGH_HEADERS` explícito antes de approbar.

### 3. **AbortController + clearTimeout(finally) inviolable**
CD-8 grabado en sangre: `finally { clearTimeout(timer) }` DEBE estar en todos los code paths (success, error, abort, generic exception). Test con fake timers + clearSpy es defensa en profundidad.

**Aplicable a:** cualquier HU con timeout + async. Si reviewer no ve `finally { clearTimeout }`, rechazar.

### 4. **Breaking changes vía feature flag + documentation**
ADR-7 (receipt signature keypair switch) es breaking. Pero canary-safe porque el flag es OFF por default. Pre-activate: documentar en CLAUDE.md + `.env.example` + PR body. Post-activate: notify clients. Esto permite go-live sin rush.

**Aplicable a:** ADR futuro con breaking changes. Siempre usar feature flag + documento de avance de migración.

### 5. **Transitive test coverage aceptable si helper es unitario**
CR Nit-5: AC-3 (orchestrate forward) no tiene test dedicado porque la lógica es subset de compose + el helper se testea unitariamente. Esto es OK si el helper y el integration (compose/proxy.test.ts) cubren todos los code paths. No requiere 100% coverage redundante.

**Aplicable a:** refactorización futura con helpers. Documenta la transitividad en CR para que el reviewer entienda por qué falta un test.

### 6. **Cross-HU dependency clearance es pre-requisito**
WKH-66 depende de WKH-65 (a2a forward-key middleware deployed en Railway antes de W5 smoke). El SDD listó esto explícitamente. Lección: en F2 SPEC gate, verificar que todas las dependencias upstream estén en DONE o en timeline compatible.

**Aplicable a:** pipelines con cross-repo work (a2a + v2). Incluir en SDD §Missing Inputs.

---

## Status final

**DONE** — todos los 14 ACs PASS. Pipeline QUALITY completado sin bloqueantes. PR abierta a main (gate humano merge + Vercel env setup + canary toggle).

Próximos pasos (fuera de scope este SDD):
1. Merge PR a main (requiere human review + e2e smoke pasando).
2. Deploy a Vercel con env vars `WASIAI_A2A_BASE_URL`, `WASIAI_V2_FORWARD_KEY` setteadas.
3. Canary toggle: `V2_DELEGATE_TO_A2A` en empty → capabilities → compose → orchestrate → (optionally mcp).
4. Monitoring metrics: latency p99 vs baseline, error rates 502/504.

