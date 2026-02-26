# Sprint 3 Review — WasiAI
**Fecha de cierre:** 2026-02-26  
**Duración:** 1 sesión (~2h)

---

## Historias completadas

### HU-9.6 — Hero copy: "modelos" → "agentes" ✅
**Commit:** `d4d861f`  
**Tests:** 0 nuevos (cambio de copy puro — impacto cubierto por build TS)

- 10 claves actualizadas en namespace `home` (es + en)
- `common.search` actualizado en ambos idiomas
- 6 hardcodes eliminados de `page.tsx` → t() calls
- `SearchInput` refactorizado con `placeholder` como prop

### HU-9.4 — Code Examples como Server Component ✅
**Commit:** `0cb75ba`  
**Tests:** +9 (189 total)

- `CodeExamples.tsx` reescrito sin `'use client'` — ISR compatible
- `BASE_URL` desde `NEXT_PUBLIC_SITE_URL` — sin hardcode (violación corregida)
- `CodeExamplesTabs.tsx` creado — Client Component mínimo para tabs y botón copiar
- Agentes gratuitos (`priceUsdc: null`) → snippet con `# free agent`
- `page.tsx` actualizado para pasar `priceUsdc`

### HU-2.1 — SDK @wasiai/sdk ✅
**Commit:** `9979b7b`  
**Tests:** +45 SDK (45/45 SDK + 189/189 main = 234 totales)

- `X-API-Key` solo en `invoke()` — removido de `list()` y `get()` (endpoints públicos)
- Archivos fuera de scope movidos a `src/_future/` (createAgent, publish, x402, handlers)
- `tsup.config.ts` + `vitest.config.ts` creados
- Build genera CJS + ESM + DTS limpios
- Test crítico: `error.message` nunca contiene la API key
- `package.json` raíz: `workspaces: ["packages/*"]`
- `README.md` con hello world en < 10 líneas

---

## Métricas

| Métrica | Sprint 2 | Sprint 3 | Delta |
|---------|----------|----------|-------|
| Tests totales | 182 | 234 | +52 |
| Test files | 15 | 18 | +3 |
| Build | ✅ limpio | ✅ limpio | — |
| Commits | 5 | 5 | — |

---

## Metodología BMAD — cumplimiento Sprint 3

| Fase | Estado |
|------|--------|
| S0 → HU_APPROVED | ✅ Fer aprobó explícitamente |
| S1 + Implementation Readiness | ✅ SDDs formales, revisión San |
| SPEC_APPROVED | ✅ Fer + San aprobaron |
| SM → Story files | ✅ 3 story files generados |
| Dev → Dev Story | ✅ implementado desde story files |
| Adversarial review | ✅ Golden Path check pre-implementación + post-SDK |
| Code review formal | ⚠️ pendiente (Dev → CR) — deuda metodológica |
| Sprint cadence | ⚠️ sin planning formal del lunes (sesión inició directamente) |

---

## Deuda técnica generada

Ninguna nueva. Deuda preexistente documentada:
- `paymentHeader: any` en `/api/v1/models/[slug]/invoke/route.ts` (pre-sprint)
- URLs `wasiai-v2.vercel.app` hardcodeadas en strings de error de `mcp/route.ts` (pre-sprint)

---

## Próximo sprint — candidatos

| HU | Épica | Prioridad |
|----|-------|-----------|
| HU-3.2 Playground comparativo | E3 | P1 |
| HU-4.1 Búsqueda semántica | E4 | P1 |
| HU-2.2 SDK Python | E2 | P2 |
| i18n-01 Copias reales WasiAI (publish, dashboard) | E9 | P2 |
