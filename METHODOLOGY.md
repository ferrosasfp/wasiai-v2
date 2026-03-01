# WasiAI — Metodología de Ingeniería
## NexusAgil × Golden Path
> Repo oficial: github.com/ferrosasfp/NexusAgile
> Skill instalado: `.claude/skills/nexus-agil/`
> Última actualización: 2026-02-28

---

## Fuente de verdad

La metodología completa vive en:
```
.claude/skills/nexus-agil/SKILL.md                         ← Pipeline completo, 3 modos
.claude/skills/nexus-agil/references/agents_roster.md      ← 9 agentes con roles
.claude/skills/nexus-agil/references/story_file_template.md
.claude/skills/nexus-agil/references/sdd_template.md
.claude/skills/nexus-agil/references/adversarial_review_checklist.md
.claude/skills/nexus-agil/references/validation_report_template.md
```

**No inventar procesos. Leer el skill.**

---

## WasiAI es siempre modo QUALITY

Producción con pagos reales, usuarios reales, datos reales.
El flujo QUALITY completo es obligatorio en cada HU. Sin excepciones.

```
[Analyst + Architect] F0 — Codebase Grounding + project-context.md
[Analyst + Architect] F1 — Work Item: HU + ACs EARS + Scope
⛔ GATE 1: HU_APPROVED
[Architect + Adversary] F2 — SDD + Constraint Directives + Readiness Check
⛔ GATE 2: SPEC_APPROVED
[Architect] F2.5 — story-HU-X.X.md autocontenido (SIN ESTO NO SE CODEA)
[Dev] F3 — Anti-Hallucination Protocol + Waves + Auto-Blindaje
[Adversary] Adversarial Review → BLOQUEANTE / MENOR / OK
[Adversary + QA] Code Review → DEBE CORREGIR / SUGERENCIA
[QA] F4 — Drift Detection + ACs con evidencia archivo:línea
[Docs] DONE → _INDEX.md
git push origin master master:main
```

---

## Golden Path — Reglas inmutables de stack

### Web2
- Next.js 14 · Supabase · Tailwind · next-intl · Upstash Redis
- **Sin** `NEXT_PUBLIC_` para secrets
- **Sin** hardcodes de addresses o amounts
- **Sin** datos simulados en producción

### Web3
- Avalanche C-Chain · Solidity 0.8.24 · Foundry · **viem v2 (pinned 2.21.0)** · wagmi v3
- **NUNCA ethers.js**
- Pagos: x402 + ERC-3009
- forge test → todos pasan antes de deploy

### Agentes externos
- Repos separados de wasiai-v2 (ej: wasiai-agents)
- Stack: Hono.js + viem v2 + Groq
- Contrato de integración documentado explícitamente en el story file

---

## Gates — texto exacto requerido

| Gate | Texto exacto | Lo que NO activa |
|---|---|---|
| GATE 1 | `HU_APPROVED` | "ok", "dale", "sí", "go", "avanza" |
| GATE 2 | `SPEC_APPROVED` | "implementa", "empieza", cualquier otra cosa |

---

*NexusAgil instalado: 2026-02-28 — San*
