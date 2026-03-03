# Sprint 18 Review — "Calidad y deuda técnica S17"

**Fecha:** 2026-03-03  
**Duración:** ~2h (sesión nocturna)  
**Sprint:** 18 / NNN: 029–033  
**Estado:** ✅ CERRADO — 11/11 SP completados (100%)

---

## Resumen Ejecutivo

Sprint 100% completado en sesión nocturna de ~2h. Se cerró toda la deuda técnica crítica heredada del Sprint 17: el pipeline CI de Playwright ahora corre en GitHub Actions como merge-gate real, `refundExpired()` en WasiEscrow es ejecutable trustless por cualquier wallet (CEI pattern, sin dependencia del owner), el pre-deploy checklist automatizado evita deploys con env incompleto, y el frontend recibe dos mejoras de calidad tangibles (íconos en cards + datos dinámicos en EscrowInfoBanner).

WasiAI v2 queda listo para la ventana **Mainnet del Sprint 19**.

---

## HUs Completadas

| HU | NNN | SP | Título | Commit principal |
|----|-----|----|--------|-----------------|
| WAS-120 | 029 | 3 | Playwright CI — GitHub Actions E2E suite | `509e948` |
| WAS-118 | 030 | 3 | `refundExpired()` trustless en WasiEscrow | `67af5c8` |
| WAS-119 | 031 | 2 | Pre-deploy checklist + env validation | `00d9334` |
| WAS-121 | 032 | 1 | Fix íconos cards Home | `b60403e` |
| WAS-122 | 033 | 2 | `_callEscrow()` helper + `estimated_completion` dinámico | `f840dc4` |

### Evidencia de commits por HU

#### WAS-120 — Playwright CI (NNN-029)
- `981a26f` — SDD + Story File
- `509e948` — feat: Playwright GH Actions E2E suite + language-switcher tests
- `335ba05` — fix: scope workflow a navigation + language-switcher
- `d8620be` — Adversarial Review
- `c3ab73e` — Code Review
- `650930c` — fix: eliminar test duplicado en language-switcher.spec.ts
- `c70e7e1` — F4 QA DONE

#### WAS-118 — refundExpired() trustless (NNN-030)
- `be6cbfb` — SDD + Story File
- `67af5c8` — feat: refundExpired() trustless, CEI pattern, 3 nuevos tests
- `c70e7e1` — Adversarial Review
- `c3e90b0` — Adversarial Review
- `c134df7` — Code Review
- `6eb31a8` — F4 QA DONE

#### WAS-119 — Pre-deploy checklist (NNN-031)
- `e030f56` — SDD + Story File
- `00d9334` — feat: pre-deploy checklist + validate-env script
- `6c97a4f` — Adversarial Review
- `7bf2b87` — fix: excluir scripts/ de ESLint
- `2e7afc0` — Code Review
- `d8620be` — F4 QA DONE

#### WAS-121 — Fix íconos cards Home (NNN-032)
- `b60403e` — fix: onError fallback emoji en ModelCard cover_image
- `01ca6f1` — AR + F4 QA DONE

#### WAS-122 — _callEscrow() + estimated_completion (NNN-033)
- `f840dc4` — refactor: _callEscrow() helper + estimated_completion dinámico
- `9d19b8b` — AR + F4 QA DONE

---

## Demo Highlights

### 🔵 CI/CD — Playwright en GitHub Actions (WAS-120)
- Pipeline `.github/workflows/e2e.yml` activo en `master`/`main`
- Tests E2E: navegación y language-switcher con Chromium headless
- Merge-gate operativo: PRs bloqueados si E2E falla

### 🔵 Smart Contract — refundExpired() trustless (WAS-118)
- Cualquier wallet puede llamar `refundExpired()` tras el deadline
- CEI pattern implementado (checks → effects → interactions)
- 3 nuevos tests Foundry: expired-trustless, expired-premature, escrow-active-no-refund
- Contratos seguros para testnet y listos para mainnet audit

### 🔵 DevOps — Pre-deploy checklist (WAS-119)
- Script `scripts/validate-env.js` valida variables críticas antes del deploy
- Checklist `doc/deploy-checklist.md` documentado
- Deploy sin validación = imposible (bloqueado por script)

### 🔵 Frontend — Calidad visual (WAS-121 + WAS-122)
- Cards de Home muestran íconos/emojis correctos con fallback automático
- `EscrowInfoBanner` muestra `estimated_completion` real desde contrato
- Helper `_callEscrow()` centraliza llamadas al contrato (DRY)

---

## Métricas del Sprint

| Métrica | Valor |
|---------|-------|
| Story Points completados | 11 / 11 (100%) |
| HUs cerradas | 5 |
| NNNs producidos | 5 (029–033) |
| Commits del sprint | ~20 |
| Tests Foundry nuevos | 3 |
| Tests Playwright nuevos | ~4 |
| Incidentes durante sprint | 4 |
| Incidentes bloqueantes | 1 (PAT scope) |
| Duración de sesión | ~2h |
| Velocidad (SP/h) | ~5.5 |

---

## Estado del Producto Post-Sprint 18

- ✅ Pipeline CI verde con merge-gate real
- ✅ Contrato WasiEscrow seguro y trustless
- ✅ Deploy process automatizado y validado
- ✅ Frontend de calidad para demo/mainnet
- 🚀 **WasiAI v2 listo para ventana Mainnet — Sprint 19**
