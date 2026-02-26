# BMAD Agent Memory — WasiAI Project State

> Este archivo es la memoria de continuidad para todos los agentes BMAD.
> Se actualiza al cierre de cada sprint o decisión significativa.
> Última actualización: 2026-02-26

---

## Estado actual del proyecto

- **Fase:** Sprint 3 — pendiente inicio (necesita S0 + HU_APPROVED de Fer)
- **Tests:** 182/182 passing (0 failures)
- **Build:** limpio (0 TS errors, 0 ESLint warnings)
- **Último commit:** `4ff5ddc` — Sprint 2 closed + BACKLOG updated
- **Migrations aplicadas:** 000–016 | **Próxima:** `017_`
- **Forge tests:** 59/59

---

## Sprints cerrados

### Sprint 1 (commit `a036cbe`)
- HU-1.1: Onboarding wizard 3 pasos + custodial earnings
- HU-1.2: Formulario multi-paso + live preview + draft autosave
- HU-1.3: Test de endpoint en tiempo real + SSRF protection
- Linear: WAS-5, WAS-6, WAS-7 → Done

### Sprint 3 (commit `9979b7b`)
- HU-9.6: hero copy modelos→agentes, i18n + hardcodes eliminados de page.tsx
- HU-9.4: CodeExamples → Server Component, BASE_URL sin hardcode, CodeExamplesTabs Client Component
- HU-2.1: @wasiai/sdk — invoke/list/get, errores tipados, 45 tests, README
- Tests: 234 totales (189 main + 45 SDK) | Linear: WAS-10, WAS-28, WAS-31 → Done

### Sprint 2 (commit `4ff5ddc`)
- HU-1.4: Creator analytics — API + SummaryCards + CallsChart CSS + AlertBanner
- HU-1.5: Perfil público creator — `/creator/[username]`, ISR, SEO
- HU-3.1: Free Trial — playground, 1 trial/usuario/agente, rate limit IP
- Linear: WAS-8, WAS-9, WAS-14 → Done
- Épica 1 (Creators Reales): COMPLETA ✅

---

## Candidatos Sprint 3 (pendiente S0 + aprobación)

| HU | Épica | Linear | Prioridad |
|----|-------|--------|-----------|
| HU-2.1 SDK Node.js `@wasiai/sdk` | E2 | WAS-10 | P0 |
| UX-07 Hero copy real | UX | WAS-31 | P1 |
| UX-04 Code examples auto-generados | UX | WAS-28 | P1 |

**⚠️ IMPORTANTE:** No iniciar implementación sin HU_APPROVED + SPEC_APPROVED de Fer.
Los SDDs de HU-2.1, UX-07 y UX-04 existen en `.nexus/docs/sdd/` pero fueron escritos
prematuramente en la sesión anterior. Deben ser revisados en S0 + S1 antes de implementar.

---

## Patrones críticos que NO violar

1. `creator_profiles.id = auth.users.id` — NO hay columna `user_id`
2. `agent_calls.status` = 'success'/'error' — NO `status_code`
3. `agent_calls.latency_ms` — NO `duration_ms`
4. `createServiceClient()` para operaciones server-side privilegiadas
5. Nunca exponer body de respuestas externas en error messages al cliente
6. CSRF protection no debe removerse de endpoints existentes

---

## ADRs activos

Ver `.nexus/docs/architecture/` para documentos completos.

| ADR | Decisión clave |
|-----|---------------|
| ADR-001 a 007 | Pre-Sprint (contratos, batch settlement, viem, metrics=0) |
| ADR-008 | pending_earnings en DB, no custodial wallet |
| ADR-009 | registerAgentOnChain solo en PATCH status → active |
| ADR-010 | CallsChart = CSS bars, sin recharts |
| ADR-011 | Username derivado de email automáticamente |
| ADR-012 | Trial rate limit = lazy singleton, prefix wasiai:trial |
| ADR-013 | creator_profiles.id = auth.users.id (sin user_id separado) |

---

## 🚨 Flujo OBLIGATORIO por HU — NO hay atajos

```
IDEA
 → S0: HU + ACs + Scope + Riesgos
 → ⛔ GATE 1: Fer aprueba explícitamente (HU_APPROVED)
 → S1: SDD (rutas, schema, on-chain, UI, DoD)
 → Implementation Readiness Check (formal, workflow)
 → ⛔ GATE 2: Fer aprueba explícitamente (SPEC_APPROVED)
 → SM → Create Story → story-HU-X.X.md (OBLIGATORIO)
 → Dev → Dev Story (desde el story file, no desde conversación)
 → Adversarial Review formal
 → Code Review formal (Dev → CR)
 → QA → E2E tests desde ACs
 → npm run build (0 errores) + forge test si aplica
 → git push origin master master:main
```

### Errores que NO repetir
1. "Go" de Fer al ver el scope ≠ HU_APPROVED ni SPEC_APPROVED
2. Saltar el story file del SM (el SDD NO lo reemplaza)
3. Implementation Readiness "mental" — ejecutar el workflow
4. Mezclar roles en una sesión sin activar el agente correcto
5. Code Review nunca ejecutado — hacerlo antes de cerrar sprint

### Cadencia semanal (activa desde Sprint 3)
- Lunes: SM → Sprint Planning → sprint-status.yaml
- Miércoles: SM → Sprint Status
- Viernes: SM → Retrospectiva

---

## Deuda técnica documentada

- `base_model`, `auth_header`, `http_method` no persisten en DB al recargar draft (solo React state)
- SEC-CSP: nonces reales para CSP en prod (actualmente unsafe-inline en prod)
- ARCH-P07: Web3Provider a route group (web3)
- Cadencia semanal BMAD (planning/status/retro) no ejecutada en Sprints 1–2
