# WasiAI — CLAUDE.md

Marketplace on-chain de agentes IA en Avalanche.
URL prod: https://wasiai-v2.vercel.app
Contrato activo (Fuji v3): `0x71CddCdF8a40951a1d8C22C8774448FbcA089b53`

---

## Antes de cualquier tarea

Lee siempre:
1. `project-context.md` — contexto completo del proyecto, stack, reglas, patrones
2. `BACKLOG.md` — épicas y prioridades

---

## Metodología

Ver detalle completo: `METHODOLOGY.md`

Flujo rápido:
```
IDEA → S0 (HU) → HU_APPROVED → S1 (SDD) → SPEC_APPROVED → S2 (Código)
```

Gates obligatorios — sin aprobación de Fer no se avanza:
- `HU_APPROVED: yes`
- `SPEC_APPROVED: yes`

Antes de cada commit:
- `/bmad-review-adversarial-general`
- Checklist S2 completo
- `npm run build` limpio

---

## Golden Path (inmutable)

Ver: `.nexus/workflows/golden-path.md`

**Reglas absolutas:**
- Sin hardcodes (contratos, URLs, keys)
- Sin datos simulados en producción
- Sin `NEXT_PUBLIC_` para secrets
- Sin ethers.js → usar viem
- Sin permissionless (ERC-4337 es roadmap)
- Push: `git push origin master master:main`
- Próxima migration: `015_`

---

## Comandos clave

| Situación | Comando |
|-----------|---------|
| Idea vaga que explorar | `/bmad-agent-bmm-analyst` |
| HU clara del backlog | `"S0 — [nombre HU]"` |
| Decisión técnica importante | `/bmad-agent-bmm-architect` |
| Generar SDD | `"S1 — [HU aprobada]"` |
| Verificar readiness | `/bmad-bmm-check-implementation-readiness` |
| Implementar | `"S2 — [referencia SDD]"` |
| Revisión pre-commit | `/bmad-review-adversarial-general` |
| Desvío del SDD | `/bmad-bmm-correct-course` |
| Tests E2E | `/bmad-agent-bmm-qa` |
| Decisión multi-perspectiva | `/bmad-party-mode` |
